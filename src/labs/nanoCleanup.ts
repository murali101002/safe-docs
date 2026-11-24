import { z } from 'zod'
import type { PdfRow } from '../pdf/extract'
import { parseRowsDetailed, type LabResult, type RowParseInfo } from './parseRows'

/**
 * On-device cleanup for rows the deterministic parser could not read.
 *
 * Privacy: these raw rows may contain PII, so they are sent ONLY to
 * Chrome's on-device Gemini Nano via generateOnDevice()
 * (InferenceMode.ONLY_ON_DEVICE — the SDK never falls back to the cloud,
 * and generateOnDevice refuses any response that reports cloud inference).
 * The model must answer with strict JSON; anything that fails zod
 * validation is discarded rather than guessed.
 */

const CleanRowSchema = z.object({
  test: z.string().trim().min(1),
  value: z.number().finite().nullable(),
  unit: z.string().trim().min(1).nullable(),
  refLow: z.number().finite().nullable(),
  refHigh: z.number().finite().nullable(),
  refText: z.string().trim().min(1).nullable(),
  flag: z.enum(['H', 'L', 'N']).nullable(),
})

export interface CleanupOptions {
  /**
   * Injectable generator for tests. Defaults to the on-device model; the
   * default is deliberately not the hybrid `generate()`, so raw rows can
   * never take the cloud path.
   */
  generate?: (prompt: string) => Promise<{ text: string }>
}

/**
 * Default generator: the on-device model only. The hybrid module is
 * imported lazily so importing nanoCleanup does not require Firebase
 * config (tests run without a Firebase project).
 */
async function defaultGenerate(prompt: string): Promise<{ text: string }> {
  const { generateOnDevice } = await import('../ai/hybrid')
  return generateOnDevice(prompt)
}

export interface CleanupResult {
  /** Lab results recovered from previously unparseable rows. */
  results: LabResult[]
  /** Candidate rows whose model output failed validation and was dropped. */
  discarded: number
}

const PROMPT_HEADER = [
  'You convert rows from a medical lab report table into structured JSON.',
  'Return ONLY a JSON array — no prose, no markdown fences.',
  'One object per input row, in order, with exactly these fields:',
  '{"test": string, "value": number|null, "unit": string|null,',
  ' "refLow": number|null, "refHigh": number|null, "refText": string|null,',
  ' "flag": "H"|"L"|"N"|null}',
  'Rules: "value" is the numeric result (null if not numeric). "refText"',
  'is the printed reference range (e.g. "4.0-11.0", "<200", ">40").',
  '"flag" is only what the row itself says (H/L/N), otherwise null.',
  'If a row is not a lab result, return {"test": ""} for it — it will be',
  'discarded. Rows:',
].join('\n')

/** Rows the deterministic parser skipped — candidates for on-device cleanup. */
export function findCleanupCandidates(rows: PdfRow[]): RowParseInfo[] {
  return parseRowsDetailed(rows).rowInfo.filter(
    (info) => info.outcome === 'skipped' || info.outcome === 'pending',
  )
}

function buildPrompt(candidates: RowParseInfo[]): string {
  const lines = candidates.map((info, i) => {
    const cells = info.row.map((item) => item.text.trim()).join(' | ')
    return `ROW ${i + 1}: ${cells}`
  })
  return `${PROMPT_HEADER}\n${lines.join('\n')}`
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
 * Convert unparseable rows into LabResults using on-device inference only.
 * Invalid model output is discarded, never guessed.
 */
export async function cleanupUnparsedRows(
  rows: PdfRow[],
  options: CleanupOptions = {},
): Promise<CleanupResult> {
  const candidates = findCleanupCandidates(rows)
  if (candidates.length === 0) return { results: [], discarded: 0 }

  const generate = options.generate ?? defaultGenerate
  const { text } = await generate(buildPrompt(candidates))

  let parsed: unknown
  try {
    parsed = extractJsonArray(text)
  } catch {
    return { results: [], discarded: candidates.length }
  }
  if (!Array.isArray(parsed)) {
    return { results: [], discarded: candidates.length }
  }

  const results: LabResult[] = []
  let discarded = 0
  for (let i = 0; i < parsed.length; i++) {
    const checked = CleanRowSchema.safeParse(normalizeFlag(parsed[i]))
    if (!checked.success) {
      discarded++
      continue
    }
    const clean = checked.data
    if (clean.test === '') {
      // Model marked the row as not-a-result.
      discarded++
      continue
    }
    const page = candidates[Math.min(i, candidates.length - 1)]?.row[0]?.page ?? 1
    results.push({
      test: clean.test,
      value: clean.value,
      unit: clean.unit,
      refLow: clean.refLow,
      refHigh: clean.refHigh,
      refText: clean.refText,
      flag: clean.flag,
      page,
    })
  }
  return { results, discarded }
}
