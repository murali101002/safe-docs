import type { RedactionSpan, RedactionType } from './types'

/**
 * Layer 1: deterministic PII detection.
 *
 * Every rule is a plain regular expression, so results are reproducible and
 * testable: the golden corpus in src/redact/regex.test.ts requires 100%
 * recall on every class below. Person names are NOT detected here (regex
 * cannot do names) — that is layer 2 (src/redact/nanoRedact.ts), plus the
 * deterministic "Patient: <name>" label form.
 *
 * Dates: a DOB (labeled) is always redacted. Other dates (collection,
 * report dates) are deliberately kept — the trend feature needs them and a
 * date alone is not an identifier; users can redact anything manually in
 * the review screen.
 */

interface RawSpan {
  start: number
  end: number
  type: RedactionType
}

/** Detector priority; earlier types win overlaps. */
const ORDER: RedactionType[] = [
  'SSN',
  'PHONE',
  'EMAIL',
  'DOB',
  'MRN',
  'INSURANCE',
  'ADDRESS',
  'ZIP',
  'NAME',
]

const DATE_VALUE =
  `(?:${'\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4}'}|${'\\d{4}-\\d{2}-\\d{2}'}|` +
  `[A-Za-z]{3,9}\\.?\\s+\\d{1,2},?\\s+\\d{4})`

/** Find all matches of a groupless global regex; span = whole match. */
function matches(text: string, pattern: RegExp, type: RedactionType): RawSpan[] {
  const spans: RawSpan[] = []
  pattern.lastIndex = 0
  for (let m = pattern.exec(text); m !== null; m = pattern.exec(text)) {
    if (m[0].length === 0) break // empty-match guard
    spans.push({ start: m.index, end: m.index + m[0].length, type })
  }
  return spans
}

/**
 * For "LABEL <value>" rules: the match covers label + value but only the
 * value should be replaced. Returns a span for capture group 1.
 */
function labeledMatches(
  text: string,
  pattern: RegExp,
  type: RedactionType,
): RawSpan[] {
  const spans: RawSpan[] = []
  pattern.lastIndex = 0
  for (let m = pattern.exec(text); m !== null; m = pattern.exec(text)) {
    if (m[0].length === 0 || m[1] === undefined || m[1].length === 0) break
    const label = m[0].length - m[1].length
    spans.push({ start: m.index + label, end: m.index + m[0].length, type })
  }
  return spans
}

const SSN_BARE = /\b\d{3}-\d{2}-\d{4}\b/g
const SSN_LABELED =
  /\b(?:SSN|S\.S\.N\.?)\s*[:#-]?\s*(\d{3}[\s-]\d{2}[\s-]\d{4})\b/gi

// Lookbehind instead of \b: "(555) 867-5309" starts with a non-word char.
const PHONE_PATTERN =
  /(?<!\w)(?:\+?1[-. ]?)?(?:\(\d{3}\)|\d{3})[-. ]\d{3}[-. ]\d{4}\b/g

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g

const DOB_PATTERN = new RegExp(
  `\\b(?:DOB|D\\.O\\.B\\.?|Date\\s+of\\s+Birth|Birth\\s+Date|Born(?:\\s+on)?)` +
    `\\s*[:#-]?\\s*(${DATE_VALUE})`,
  'gi',
)

const MRN_PATTERN =
  /\b(?:MRN|Medical\s+Record(?:\s+No\.?|\s+Number)?|Record\s+No\.?)\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{3,19})\b/gi

const INSURANCE_PATTERN =
  /\b(?:Member\s*(?:ID|No\.?|Number)|Policy\s*(?:ID|No\.?|Number|#)|Insurance\s*(?:ID|No\.?|Number)|Group\s*(?:ID|No\.?|Number|#)|Subscriber\s*ID)\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9-]{3,19})\b/gi

const ADDRESS_PATTERN = new RegExp(
  `\\b\\d{1,6}\\s+[A-Za-z0-9.' ]{2,40}?\\s+` +
    `(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Way|` +
    `Court|Ct|Place|Pl|Terrace|Ter|Circle|Cir|Highway|Hwy)\\.?` +
    // Optional ", City, ST 12345" tail (street alone also matches).
    `(?:,\\s*[A-Za-z .'()-]{2,30}?,\\s*[A-Z]{2}\\s+${'\\d{5}'}(?:-\\d{4})?)?`,
  'g',
)

const ZIP_LABELED =
  /\b(?:Zip|ZIP|Zip\s*Code|Postal\s*Code)\s*[:#]?\s*(\d{5}(?:-\d{4})?)\b/g

/** "Springfield, IL 62704" — redact the zip digits after a state code. */
const ZIP_AFTER_STATE = /\b[A-Z]{2}\s+(\d{5}(?:-\d{4})?)\b/g

/** "Patient: <name>" — the one deterministic name form. */
const PATIENT_NAME_PATTERN = /\bPatient\s*:\s*([^\n|,]{2,40})/g

/** Run every detector; returns raw (unmerged) spans. */
function detectAll(text: string): RawSpan[] {
  const spans: RawSpan[] = [
    ...matches(text, SSN_BARE, 'SSN'),
    ...labeledMatches(text, SSN_LABELED, 'SSN'),
    ...matches(text, PHONE_PATTERN, 'PHONE'),
    ...matches(text, EMAIL_PATTERN, 'EMAIL'),
    ...labeledMatches(text, DOB_PATTERN, 'DOB'),
    ...labeledMatches(text, MRN_PATTERN, 'MRN'),
    ...labeledMatches(text, INSURANCE_PATTERN, 'INSURANCE'),
    ...matches(text, ADDRESS_PATTERN, 'ADDRESS'),
    ...labeledMatches(text, ZIP_LABELED, 'ZIP'),
    ...labeledMatches(text, ZIP_AFTER_STATE, 'ZIP'),
    ...labeledMatches(text, PATIENT_NAME_PATTERN, 'NAME'),
  ]
  // Never include trailing whitespace in a token.
  return spans.map((span) => {
    let end = span.end
    while (end > span.start && /\s/.test(text[end - 1])) end--
    return { ...span, end }
  })
}

/**
 * Resolve overlaps: earlier detector in ORDER wins; ties broken by
 * earlier start, then longer span. Output is sorted by start.
 */
export function resolveSpans(spans: RawSpan[]): RawSpan[] {
  const rank = new Map<RedactionType, number>()
  ORDER.forEach((type, i) => rank.set(type, i))
  const sorted = [...spans].sort((a, b) => {
    const r = (rank.get(a.type) ?? 99) - (rank.get(b.type) ?? 99)
    if (r !== 0) return r
    if (a.start !== b.start) return a.start - b.start
    return b.end - b.start - (a.end - a.start) // longer span first
  })
  const accepted: RawSpan[] = []
  for (const span of sorted) {
    if (span.end <= span.start) continue
    const overlaps = accepted.some(
      (kept) => span.start < kept.end && kept.start < span.end,
    )
    if (!overlaps) accepted.push(span)
  }
  return accepted.sort((a, b) => a.start - b.start)
}

/** Detect deterministic (regex) PII spans, merged and sorted. */
export function detectRegexSpans(text: string): RedactionSpan[] {
  return resolveSpans(detectAll(text)).map((span, i) => ({
    id: `r${i}`,
    start: span.start,
    end: span.end,
    type: span.type,
  }))
}
