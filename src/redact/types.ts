/** Shared redaction types. */

/** What kind of PII a redaction covers. */
export type RedactionType =
  | 'SSN'
  | 'PHONE'
  | 'EMAIL'
  | 'DOB'
  | 'MRN'
  | 'INSURANCE'
  | 'ADDRESS'
  | 'ZIP'
  | 'NAME'
  | 'CUSTOM'

/** All types the deterministic regex layer can find. */
export const REGEX_TYPES = [
  'SSN',
  'PHONE',
  'EMAIL',
  'DOB',
  'MRN',
  'INSURANCE',
  'ADDRESS',
  'ZIP',
  'NAME',
] as const satisfies readonly RedactionType[]

/** One proposed redaction: a half-open [start, end) range in the document text. */
export interface RedactionSpan {
  id: string
  start: number
  end: number
  type: RedactionType
}

/** One token in the token map, e.g. [NAME_1] -> "Jane Testpatient". */
export interface TokenEntry {
  token: string
  type: RedactionType
  /** The real value. Stored on-device only — never synced. */
  value: string
}

/** Ordered token map for one document. */
export type TokenMap = TokenEntry[]

/** Build the token string for a type and 1-based number. */
export function tokenFor(type: RedactionType, n: number): string {
  return `[${type}_${n}]`
}
