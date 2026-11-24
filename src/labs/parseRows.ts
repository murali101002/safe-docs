import type { PdfRow, PdfTextItem } from '../pdf/extract'

/**
 * Lab table extraction: turns grouped PDF rows into structured lab results.
 *
 * The input is what src/pdf/extract.ts produces: rows of positioned text
 * cells sharing a baseline. Reports vary a lot, so this parser is
 * deliberately conservative — anything it cannot parse with certainty is
 * reported as "skipped" for src/labs/nanoCleanup.ts to fix up with the
 * on-device model (raw rows are never sent anywhere except on-device).
 */

/** One parsed lab measurement. */
export interface LabResult {
  test: string
  value: number | null
  unit: string | null
  refLow: number | null
  refHigh: number | null
  /** The reference-range cell exactly as printed (e.g. "4.0-11.0", "<200"). */
  refText: string | null
  /** H = above range, L = below range, N = normal, null = unknown. */
  flag: 'H' | 'L' | 'N' | null
  page: number
}

/** What the deterministic parser decided to do with one row. */
export type RowParseOutcome =
  | 'result' // row yielded one or more LabResults
  | 'continuation' // text row merged into a result's name or pending name
  | 'pending' // text row accumulated as a possible wrapped name
  | 'header' // column-header row
  | 'section' // ALL-CAPS section title (e.g. "CHEMISTRY")
  | 'metadata' // patient/MRN/collection-date line
  | 'skipped' // could not be parsed deterministically

export interface RowParseInfo {
  row: PdfRow
  outcome: RowParseOutcome
  results: LabResult[]
}

export interface ParseRowsResult {
  results: LabResult[]
  rowInfo: RowParseInfo[]
}

/* ------------------------------------------------------------------ */
/* Cell classifiers                                                    */
/* ------------------------------------------------------------------ */

/**
 * Canonicalize lookalike characters before classification. pdf.js decodes
 * the WinAnsi micro-sign glyph to U+03BC (Greek mu) in some ToUnicode maps;
 * treat it as U+00B5 (micro sign) so units like µU/mL classify correctly.
 */
export function canonicalizeText(text: string): string {
  return text.replace(/\u03BC/g, '\u00B5')
}

interface ParsedValueCell {
  value: number
  unit: string | null
  flag: 'H' | 'L' | 'N' | null
}

const FLAG_LETTERS = new Set(['H', 'L', 'N'])

/** Single-letter out-of-range marker, as its own cell. */
function isFlagLikeCell(text: string): boolean {
  return FLAG_LETTERS.has(text.toUpperCase()) && text.length === 1
}

/**
 * Units: a single token containing "/" or "%" or a known unit word.
 * Multi-word cells (e.g. "Chol/HDL Ratio") are never units.
 */
const UNIT_WORDS = new Set([
  'mg', 'g', 'kg', 'ml', 'l', 'dl', 'ul', 'µl', 'fl', 'pg', 'ng', 'µg',
  'iu', 'u', 'mu', 'µu', 'meq', 'mmol', 'µmol', 'mmhg', 'kpa', 'sec',
  'min', 'hr', 'ratio', 'au', 'eu', 'tu', 'ph',
])

function isUnitLikeCell(text: string): boolean {
  const t = text.trim()
  if (t === '' || /\s/.test(t)) return false
  if (isFlagLikeCell(t)) return false
  const token = /^[A-Za-zµ%0-9^*×/.\-[\]]{1,12}$/
  if (!token.test(t)) return false
  if (t.includes('/') || t.includes('%')) return true
  return UNIT_WORDS.has(t.toLowerCase())
}

/** Parse a numeric cell like "12.5", "13.5 H", "5,200 /µL", "<0.5". */
function parseValueCell(raw: string): ParsedValueCell | null {
  let t = raw.trim()
  if (t === '') return null

  // Trailing single-letter flag ("13.5 H"); only if what remains starts
  // with a number/</> so unit-less names like "Column N" are not values.
  let flag: ParsedValueCell['flag'] = null
  const flagMatch = /^(.+[.\d])\s+([HLN])$/i.exec(t)
  if (flagMatch) {
    t = flagMatch[1].trim()
    flag = flagMatch[2].toUpperCase() as ParsedValueCell['flag']
  }

  // Optional comparison prefix ("<0.5").
  t = t.replace(/^[<>]\s*/, '')

  const numberMatch = /^(\d[\d,]*(?:\.\d+)?)(.*)$/.exec(t)
  if (!numberMatch) return null
  const value = Number.parseFloat(numberMatch[1].replace(/,/g, ''))
  if (Number.isNaN(value)) return null

  // Everything after the number must be a clean unit token or nothing,
  // otherwise the cell is not a value we can trust (e.g. "19:1"). A
  // superscript-notation remainder ("10" + "^3/µL") means the whole cell is
  // a unit like 10^3/µL, not a value — but a digit-leading unit token
  // ("250 10^3/µL") is a legitimate embedded unit.
  let rest = numberMatch[2].trim()
  if (rest !== '') {
    if (rest.startsWith('^') || rest.startsWith('*') || !isUnitLikeCell(rest)) return null
  }

  return { value, unit: rest === '' ? null : rest, flag }
}

/** Parse a reference-range cell: "4.0-11.0", "<200", ">40", "70-99 mg/dL". */
function parseRefCell(raw: string): { refLow: number | null; refHigh: number | null } | null {
  let t = raw.trim()
  if (t.length > 40) return null
  // Unwrap one pair of parentheses: "(4.0-11.0)".
  const paren = /^\((.*)\)$/.exec(t)
  if (paren) t = paren[1].trim()
  // Drop a trailing unit token ("4.0-11.0 %") — refText keeps the original.
  t = t.replace(/\s+[A-Za-zµ%][A-Za-zµ%0-9^*×/]{0,11}$/, '').trim()

  const num = '\\d[\\d,]*(?:\\.\\d+)?'
  const range = new RegExp(`^(${num})\\s*(?:-|–|—|\\bto\\b)\\s*(${num})$`, 'i').exec(t)
  if (range) {
    return { refLow: parseNum(range[1]), refHigh: parseNum(range[2]) }
  }
  const upper = new RegExp(`^[<≤]\\s*(${num})$`).exec(t)
  if (upper) return { refLow: null, refHigh: parseNum(upper[1]) }
  const lower = new RegExp(`^[>≥]\\s*(${num})$`).exec(t)
  if (lower) return { refLow: parseNum(lower[1]), refHigh: null }
  return null
}

function parseNum(s: string): number {
  return Number.parseFloat(s.replace(/,/g, ''))
}

/** A cell that reads like a reference range (and therefore not a value). */
function isRefLikeCell(text: string): boolean {
  return parseRefCell(text) !== null
}

/** A cell that reads like a test name: letters, not a value/unit/ref/flag. */
function isNameLikeCell(text: string): boolean {
  const t = text.trim()
  if (t === '') return false
  if (!/[A-Za-z]{1,}/.test(t)) return false
  if (parseValueCell(t) !== null) return false
  if (isUnitLikeCell(t)) return false
  if (isRefLikeCell(t)) return false
  if (isFlagLikeCell(t)) return false
  return true
}

/* ------------------------------------------------------------------ */
/* Row-level recognizers                                               */
/* ------------------------------------------------------------------ */

const HEADER_KEYWORDS =
  /\b(test|result|value|units?|flag|reference|range|specimen|analysis)\b/i

const METADATA_PATTERN =
  /\b(patient|dob|date of birth|mrn|medical record|accession|collected|reported|received|physician|provider|ordered by|drawn)\b/i

function isHeaderRow(cells: string[]): boolean {
  let keywords = 0
  for (const cell of cells) if (HEADER_KEYWORDS.test(cell)) keywords++
  return keywords >= 2
}

/** ALL-CAPS line used as a panel/section title. */
function isSectionRow(cells: string[]): boolean {
  // Section titles contain no digits ("COMPLETE BLOOD COUNT"); a row like
  // "WBC 12.5 10^3/µL 4.0-11.0" is data, even though its remaining letters
  // are all uppercase.
  if (/\d/.test(cells.join(' '))) return false
  const letters = cells.join(' ').replace(/[^A-Za-z]/g, '')
  if (letters.length < 3) return false
  for (const cell of cells) {
    const alpha = cell.replace(/[^A-Za-z]/g, '')
    if (alpha !== '' && alpha !== alpha.toUpperCase()) return false
  }
  return true
}

function isMetadataRow(cells: string[]): boolean {
  return METADATA_PATTERN.test(cells.join(' '))
}

/* ------------------------------------------------------------------ */
/* Main parser                                                         */
/* ------------------------------------------------------------------ */

/**
 * Parse grouped rows into lab results, with per-row outcomes so callers can
 * know which rows need on-device cleanup.
 */
export function parseRowsDetailed(rows: PdfRow[]): ParseRowsResult {
  const results: LabResult[] = []
  const rowInfo: RowParseInfo[] = []
  let pendingName = ''
  const pendingRowIndexes: number[] = []

  for (const row of rows) {
    const texts = row.map((item) => canonicalizeText(item.text).trim())
    const outcomeInfo: RowParseInfo = { row, outcome: 'skipped', results: [] }
    const index = rowInfo.length
    rowInfo.push(outcomeInfo)

    if (isMetadataRow(texts)) {
      outcomeInfo.outcome = 'metadata'
      pendingName = ''
      pendingRowIndexes.length = 0
      continue
    }
    if (isHeaderRow(texts)) {
      outcomeInfo.outcome = 'header'
      pendingName = ''
      pendingRowIndexes.length = 0
      continue
    }
    if (isSectionRow(texts)) {
      outcomeInfo.outcome = 'section'
      pendingName = ''
      pendingRowIndexes.length = 0
      continue
    }

    // Find every value cell in the row (multi-column layouts have several).
    const valueIndexes: number[] = []
    for (let i = 0; i < texts.length; i++) {
      const text = texts[i]
      if (text === '') continue
      if (isRefLikeCell(text)) continue
      if (parseValueCell(text) !== null) valueIndexes.push(i)
    }

    if (valueIndexes.length === 0) {
      // Text-only row: a wrapped test-name fragment (a single cell on the
      // name column), or junk. Multi-cell text rows are treated as junk so
      // they can never be glued onto the previous result's name; if the
      // model split a wrapped name across items on one line, the row shows
      // up here as skipped and nanoCleanup can still recover it.
      const singleNameCell =
        texts.length === 1 && isNameLikeCell(texts[0])
      const text = texts.join(' ').trim()
      if (text !== '' && singleNameCell) {
        if (pendingName !== '') {
          pendingName = `${pendingName} ${text}`
          outcomeInfo.outcome = 'pending'
          pendingRowIndexes.push(index)
        } else {
          const last = results.at(-1)
          if (last && last.page === row[0].page) {
            last.test = `${last.test} ${text}`
            outcomeInfo.outcome = 'continuation'
          } else {
            pendingName = text
            outcomeInfo.outcome = 'pending'
            pendingRowIndexes.push(index)
          }
        }
      } else {
        outcomeInfo.outcome = 'skipped'
        pendingName = ''
        pendingRowIndexes.length = 0
      }
      continue
    }

    // Parse one LabResult per value cell (handles multi-column rows).
    // If a pending name exists it belongs to this row: a wrapped test name
    // ("White Blood" \n "Cell Count 5.2 …") is prepended to the row's own
    // name fragments, or used as-is when the row has none. Rows whose text
    // is pending junk (e.g. a urinalysis section) are separated from data
    // rows by a section title, which clears the pending name.
    const hadPending = pendingName !== ''
    const rowResults: LabResult[] = []
    for (let v = 0; v < valueIndexes.length; v++) {
      const valueIndex = valueIndexes[v]
      const valueText = texts[valueIndex]
      const parsed = parseValueCell(valueText)!

      // Name: name-like cells between the previous value cell and this one.
      const stop = v > 0 ? valueIndexes[v - 1] : -1
      const nameParts: string[] = []
      for (let i = valueIndex - 1; i > stop; i--) {
        if (texts[i] !== '' && isNameLikeCell(texts[i])) nameParts.unshift(texts[i])
        else break
      }

      let name = ''
      if (nameParts.length > 0) {
        name = pendingName !== '' ? `${pendingName} ${nameParts.join(' ')}` : nameParts.join(' ')
      } else if (pendingName !== '') {
        name = pendingName
      }
      if (name === '') continue // orphan value with no test name — junk

      // Scan forward for flag / unit / reference cells.
      let flag = parsed.flag
      let unit: string | null = parsed.unit
      let refText: string | null = null
      let ref: { refLow: number | null; refHigh: number | null } | null = null
      for (let j = valueIndex + 1; j < texts.length; j++) {
        const text = texts[j]
        if (text === '') continue
        if (isRefLikeCell(text)) {
          ref = parseRefCell(text)
          refText = text
          break // reference is always the last cell of a column group
        }
        if (flag === null && isFlagLikeCell(text)) {
          flag = text.toUpperCase() as LabResult['flag']
          continue
        }
        if (unit === null && isUnitLikeCell(text)) {
          unit = text
          continue
        }
        break // next column group's name — stop scanning
      }

      rowResults.push({
        test: name,
        value: parsed.value,
        unit,
        refLow: ref?.refLow ?? null,
        refHigh: ref?.refHigh ?? null,
        refText,
        flag: computeFlag(parsed.value, ref, flag),
        page: row[valueIndex].page,
      })
    }

    if (rowResults.length > 0) {
      results.push(...rowResults)
      outcomeInfo.outcome = 'result'
      outcomeInfo.results = rowResults
      if (hadPending) {
        // The pending name was consumed by this row — its rows contributed.
        for (const i of pendingRowIndexes) rowInfo[i].outcome = 'continuation'
      }
      pendingName = ''
      pendingRowIndexes.length = 0
    } else {
      outcomeInfo.outcome = 'skipped'
      pendingName = ''
      pendingRowIndexes.length = 0
    }
  }

  return { results, rowInfo }
}

/**
 * Flag precedence: an explicit H/L/N letter printed in the report wins;
 * otherwise compute from the reference range.
 */
function computeFlag(
  value: number,
  ref: { refLow: number | null; refHigh: number | null } | null,
  explicit: 'H' | 'L' | 'N' | null,
): 'H' | 'L' | 'N' | null {
  if (explicit !== null) return explicit
  if (ref === null) return null
  const { refLow, refHigh } = ref
  if (refHigh !== null && value > refHigh) return 'H'
  if (refLow !== null && value < refLow) return 'L'
  if (refLow !== null || refHigh !== null) return 'N'
  return null
}

/** Convenience wrapper matching the F3 spec signature. */
export function parseLabResults(rows: PdfRow[]): LabResult[] {
  return parseRowsDetailed(rows).results
}

/* ------------------------------------------------------------------ */
/* Document date                                                       */
/* ------------------------------------------------------------------ */

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

const DATE_VALUE = `(\\d{4}-\\d{2}-\\d{2}|${'\\d{1,2}/\\d{1,2}/\\d{4}'}|[A-Za-z]{3,9}\\.?\\s+\\d{1,2},?\\s+\\d{4})`
const DATE_LINE = new RegExp(
  `(?:collected(?:\\s+on)?|collection\\s+date|date\\s+collected|report(?:ed)?(?:\\s+date)?|accessioned?)` +
    `\\s*[:\\-]?\\s*${DATE_VALUE}`,
  'i',
)

/** Normalize "2026-01-15", "03/15/2026", "Jan 5, 2026" to YYYY-MM-DD. */
export function normalizeDate(raw: string): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  if (iso) return raw
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw)
  if (slash) {
    const mm = slash[1].padStart(2, '0')
    const dd = slash[2].padStart(2, '0')
    return `${slash[3]}-${mm}-${dd}`
  }
  const words = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(raw)
  if (words) {
    const month = MONTHS[words[1].slice(0, 3).toLowerCase()]
    if (month === undefined) return null
    return `${words[3]}-${String(month).padStart(2, '0')}-${words[2].padStart(2, '0')}`
  }
  return null
}

/**
 * Find the specimen collection/report date for the document by scanning
 * metadata lines ("Collected: 03/15/2026"). Returns YYYY-MM-DD or null.
 */
export function parseDocDate(rows: PdfRow[]): string | null {
  for (const row of rows) {
    const line = row.map((item: PdfTextItem) => item.text).join(' ')
    const match = DATE_LINE.exec(line)
    if (match) {
      const normalized = normalizeDate(match[1])
      if (normalized) return normalized
    }
  }
  return null
}
