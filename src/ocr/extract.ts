import { z } from 'zod'

/**
 * On-device OCR for photographed/scanned lab pages (feature 08).
 *
 * The image is analyzed by Chrome's on-device model ONLY (generateOnDevice,
 * InferenceMode.ONLY_ON_DEVICE). If the on-device model is unavailable the
 * scan FAILS with a friendly message — the image is never sent to the
 * cloud. Numbers are copied EXACTLY as printed: the model is told not to
 * correct anything, because a wrong number is a failure the user must see
 * and confirm, not something to auto-fix.
 */

export const OCR_PROMPT = [
  'Read the lab report in this image. Return ONLY a JSON array — no prose,',
  'no markdown fences. One object per result row, with exactly these fields:',
  '{"label": string, "value": number|null, "unit": string|null,',
  ' "refLow": number|null, "refHigh": number|null, "refText": string|null,',
  ' "flag": "H"|"L"|"N"|null}',
  'Copy every number EXACTLY as printed — never correct, guess, or round.',
  'If a value is not readable, set it to null (do not guess).',
  'Skip headers, titles, patient lines, and non-result rows.',
].join('\n')

const OcrRowSchema = z.object({
  label: z.string().trim().min(1),
  value: z.number().finite().nullable(),
  unit: z.string().trim().min(1).nullable(),
  refLow: z.number().finite().nullable(),
  refHigh: z.number().finite().nullable(),
  refText: z.string().trim().min(1).nullable(),
  flag: z.enum(['H', 'L', 'N']).nullable(),
})

export type OcrRow = z.infer<typeof OcrRowSchema> & { label: string }

export interface ParsedScan {
  rows: OcrRow[]
  /** Items that failed zod validation (e.g. text labels where numbers belong). */
  discarded: number
}

/** Pull the JSON array out of a model reply (tolerates markdown fences). */
export function extractJsonArray(text: string): unknown {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('no JSON array in on-device output')
  }
  return JSON.parse(text.slice(start, end + 1))
}

/** Uppercase a single-letter flag so "h" validates as "H". */
function normalizeFlag(row: unknown): unknown {
  if (row !== null && typeof row === 'object' && 'flag' in row) {
    const { flag, ...rest } = row as Record<string, unknown>
    if (typeof flag === 'string' && flag.length === 1) {
      return { ...rest, flag: flag.toUpperCase() }
    }
  }
  return row
}

/**
 * Parse the model's vision output into confirmed-candidate rows.
 * Invalid entries are discarded, never guessed.
 */
export function parseOcrRows(text: string): ParsedScan {
  let parsed: unknown
  try {
    parsed = extractJsonArray(text)
  } catch {
    return { rows: [], discarded: 0 }
  }
  if (!Array.isArray(parsed)) return { rows: [], discarded: 0 }

  const rows: OcrRow[] = []
  let discarded = 0
  for (const item of parsed) {
    const checked = OcrRowSchema.safeParse(normalizeFlag(item))
    if (!checked.success) {
      discarded++
      continue
    }
    if (checked.data.label === '') {
      discarded++
      continue
    }
    rows.push(checked.data)
    if (rows.length >= 60) break
  }
  return { rows, discarded }
}

/**
 * Accuracy for the golden OCR tests: fraction of rows whose value, unit,
 * and flag EXACTLY match the expected results. A wrong number (a value that
 * differs from the printed one) is a FAILURE — never auto-corrected.
 */
export interface ScanAccuracy {
  correct: number
  total: number
  accuracy: number
  wrongNumbers: number
  failures: Array<{ label: string; field: string; expected: unknown; got: unknown }>
}

export function scanAccuracy(parsed: OcrRow[], expected: OcrRow[]): ScanAccuracy {
  const failures: ScanAccuracy['failures'] = []
  let wrongNumbers = 0
  let correct = 0
  const total = Math.max(parsed.length, expected.length)
  for (let i = 0; i < Math.max(parsed.length, expected.length); i++) {
    const got = parsed[i]
    const want = expected[i]
    if (got === undefined || want === undefined) {
      failures.push({
        label: (want ?? got)?.label ?? `row ${i}`,
        field: got === undefined ? 'missing row' : 'extra row',
        expected: want?.value ?? null,
        got: got?.value ?? null,
      })
      if (got === undefined || want === undefined) continue
    }
    const fields: Array<[string, unknown, unknown]> = [
      ['value', want.value, got.value],
      ['unit', want.unit, got.unit],
      ['flag', want.flag, got.flag],
    ]
    let rowOk = true
    for (const [field, exp, act] of fields) {
      if (exp !== act) {
        rowOk = false
        if (field === 'value') wrongNumbers++
        failures.push({ label: want.label, field, expected: exp, got: act })
      }
    }
    if (rowOk) correct++
  }
  return {
    correct,
    total,
    accuracy: total === 0 ? 1 : correct / total,
    wrongNumbers,
    failures,
  }
}
