/**
 * RedactedText — the only form of document text allowed to reach the cloud.
 *
 * Hard rule 1: raw (unredacted) text must never be sent to the cloud. This
 * module is the SINGLE place that can create a RedactedText:
 *
 * - Compile time: the brand key is a `unique symbol` that is NOT exported,
 *   so no other module can name or construct the type (`as`-casts from a
 *   plain object fail; only `as unknown as` can bypass, which the guard
 *   test uses deliberately to prove the RUNTIME check still fires).
 * - Run time: every instance carries a token under a module-private symbol;
 *   `requireRedacted()` (used by the cloud choke point in src/ai/cloud.ts)
 *   refuses anything without it.
 */

const REDACTED_BRAND = Symbol('SafeDocs.RedactedText')

export interface RedactedText {
  /** Approved redacted text: PII replaced with tokens like [NAME_1]. */
  readonly text: string
  /** Document the text belongs to (token maps are stored per document). */
  readonly docId: string
  readonly [REDACTED_BRAND]: true
}

export interface RedactedTextInit {
  text: string
  docId: string
}

/**
 * Create an approved RedactedText. MUST only be called from the redact
 * module (src/redact/*) — it is the single construction point in the app.
 */
export function createRedactedText(init: RedactedTextInit): RedactedText {
  return Object.freeze({
    text: init.text,
    docId: init.docId,
    [REDACTED_BRAND]: true as const,
  })
}

/** Runtime type guard for the brand token. */
export function isRedactedText(value: unknown): value is RedactedText {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<symbol, unknown>)[REDACTED_BRAND] === true
  )
}

/**
 * Runtime gate used by the cloud choke point: throws unless the value was
 * produced by the redact module (approved review output).
 */
export function requireRedacted(value: unknown): RedactedText {
  if (!isRedactedText(value)) {
    throw new Error(
      'Blocked: cloud inference requires approved RedactedText from the ' +
        'redaction module — raw text can never be sent to the cloud.',
    )
  }
  return value
}
