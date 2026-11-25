import {
  createRedactedText,
  type RedactedText,
} from './brand'
import { detectRegexSpans } from './regex'
import { nanoFindings } from './nanoRedact'
import {
  tokenFor,
  type RedactionSpan,
  type RedactionType,
  type TokenMap,
} from './types'

/**
 * Redaction pipeline.
 *
 * 1. detectRedactions: regex layer + (optionally) on-device Nano layer for
 *    names/addresses — raw text never leaves the device for this.
 * 2. The user reviews the draft (remove anything, add custom redactions).
 * 3. approveRedactions is the ONLY place in the app that produces a
 *    RedactedText, and it requires the reviewed spans.
 */

export interface DetectOptions {
  /**
   * Run layer 2 (on-device Nano) for names/addresses. Default true; callers
   * should pass false when Chrome's on-device model is unavailable.
   */
  useNano?: boolean
  /** Injectable Nano generator for tests (defaults to on-device only). */
  generate?: (prompt: string) => Promise<{ text: string }>
}

/**
 * Detect PII in document text and return reviewable spans.
 * Deterministic layer always runs; the Nano layer is best-effort.
 */
export async function detectRedactions(
  text: string,
  options: DetectOptions = {},
): Promise<RedactionSpan[]> {
  const spans = [...detectRegexSpans(text)]
  if (options.useNano === false) return assignIds(spans)

  let extra: RedactionSpan[] = []
  try {
    const findings = await nanoFindings(text, options.generate)
    extra = findingsToSpans(text, findings, spans)
  } catch {
    // On-device model unavailable or unusable — regex-only is safe to ship;
    // the review screen tells the user to redact names manually.
  }
  return assignIds(mergeSpans([...spans, ...extra]))
}

/** Convert Nano findings into spans, skipping overlaps with existing ones. */
function findingsToSpans(
  text: string,
  findings: Array<{ text: string; type: RedactionType }>,
  existing: RedactionSpan[],
): RedactionSpan[] {
  const spans: RedactionSpan[] = []
  for (const finding of findings) {
    const needle = finding.text
    // Redact EVERY occurrence of the value ("Jane Testpatient" appears in
    // the header and again in the body).
    let at = text.indexOf(needle)
    while (at !== -1) {
      const span: RedactionSpan = {
        id: '',
        start: at,
        end: at + needle.length,
        type: finding.type,
      }
      const overlaps = [...existing, ...spans].some(
        (kept) => span.start < kept.end && kept.start < span.end,
      )
      if (!overlaps) spans.push(span)
      at = text.indexOf(needle, at + needle.length)
    }
  }
  return spans
}

/** Sort spans, drop overlaps (longer/earlier wins), assign ids. */
function mergeSpans(spans: RedactionSpan[]): RedactionSpan[] {
  const sorted = [...spans].sort(
    (a, b) => a.start - b.start || b.end - b.start - (a.end - a.start),
  )
  const accepted: RedactionSpan[] = []
  for (const span of sorted) {
    const overlaps = accepted.some(
      (kept) => span.start < kept.end && kept.start < span.end,
    )
    if (!overlaps) accepted.push(span)
  }
  return accepted.sort((a, b) => a.start - b.start)
}

function assignIds(spans: RedactionSpan[]): RedactionSpan[] {
  return spans.map((span, i) => ({ ...span, id: `s${i}` }))
}

export interface ApprovedRedaction {
  redacted: RedactedText
  tokenMap: TokenMap
  /** The kept spans, for the UI to show what was applied. */
  kept: RedactionSpan[]
}

/**
 * Apply the reviewed redactions: replace each kept span with a token
 * ([TYPE_n], the same value sharing one token), and produce the
 * RedactedText plus the on-device-only token map.
 */
export function approveRedactions(
  text: string,
  docId: string,
  spans: RedactionSpan[],
  keptIds: ReadonlySet<string>,
): ApprovedRedaction {
  const kept = mergeSpans(spans.filter((span) => keptIds.has(span.id)))
  const { redactedText, tokenMap } = applyTokens(text, kept)
  return {
    redacted: createRedactedText({ text: redactedText, docId }),
    tokenMap,
    kept,
  }
}

/** Replace spans with tokens; group identical values under one token. */
export function applyTokens(
  text: string,
  spans: RedactionSpan[],
): { redactedText: string; tokenMap: TokenMap } {
  // Defensive: resolve overlaps here too (longer/earlier span wins), so a
  // caller passing overlapping spans can never leave raw PII behind.
  const sorted = [...spans].sort(
    (a, b) => a.start - b.start || b.end - b.start - (a.end - a.start),
  )
  const accepted: RedactionSpan[] = []
  for (const span of sorted) {
    if (span.end <= span.start) continue
    const overlaps = accepted.some(
      (kept) => span.start < kept.end && kept.start < span.end,
    )
    if (!overlaps) accepted.push(span)
  }
  const resolved = accepted.sort((a, b) => a.start - b.start)

  const nextNumber = new Map<RedactionType, number>()
  const tokenByValue = new Map<string, string>()
  const tokenMap: TokenMap = []

  const pieces: string[] = []
  let cursor = 0
  for (const span of resolved) {
    const value = text.slice(span.start, span.end)
    pieces.push(text.slice(cursor, span.start))
    let token = tokenByValue.get(value)
    if (token === undefined) {
      const n = (nextNumber.get(span.type) ?? 0) + 1
      nextNumber.set(span.type, n)
      token = tokenFor(span.type, n)
      tokenByValue.set(value, token)
      tokenMap.push({ token, type: span.type, value })
    }
    pieces.push(token)
    cursor = span.end
  }
  pieces.push(text.slice(cursor))
  return { redactedText: pieces.join(''), tokenMap }
}

/**
 * Swap tokens back to real values, locally. Used to make cloud answers
 * readable again — the token map never leaves the device.
 */
export function rehydrate(text: string, tokenMap: TokenMap): string {
  let out = text
  for (const entry of tokenMap) {
    if (entry.token === '') continue
    out = out.split(entry.token).join(entry.value)
  }
  return out
}
