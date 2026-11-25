import type { Chunk } from '../retrieval/chunk'
import { docLabelOf } from './qa'
import { resolveGenerate, SAFETY_RULES, type IntelligenceOptions } from './options'

/**
 * Map-reduce document summary, fully on-device with progress reporting:
 * each chunk is summarized (map), then the partials are combined (reduce).
 * Chunk failures are skipped, never fatal; an all-failed run throws.
 */

export interface SummaryProgress {
  done: number
  total: number
}

export interface SummaryInput {
  chunks: Chunk[]
  docId: string
}

export interface SummaryOptions extends IntelligenceOptions {
  onProgress?: (progress: SummaryProgress) => void
}

export function buildSectionPrompt(input: { chunk: Chunk; docId: string }): string {
  return [
    SAFETY_RULES,
    '- Summarize the document section below in 2-3 plain-language sentences.',
    '- Do not invent facts; skip anything unclear.',
    '',
    `[SOURCE: ${docLabelOf(input.docId)}, page ${input.chunk.pages.join(', ')}]`,
    input.chunk.text,
  ].join('\n')
}

export function buildReducePrompt(input: {
  docId: string
  partials: string[]
}): string {
  return [
    SAFETY_RULES,
    '- Combine the section summaries below into ONE cohesive plain-language summary of the whole document.',
    '- 4-7 sentences. Say what kind of document it is and the main findings, with citations like ['
      + docLabelOf(input.docId) + ', page N] where a section summary included one.',
    '- Informational only; end by suggesting the patient review the report with their clinician.',
    '',
    'Section summaries:',
    input.partials.map((p, i) => `[${i + 1}] ${p}`).join('\n\n'),
  ].join('\n')
}

/** Summarize a document map-reduce style, reporting progress per chunk. */
export async function summarizeDocument(
  input: SummaryInput,
  options: SummaryOptions = {},
): Promise<{ summary: string; partials: string[] }> {
  const generate = resolveGenerate(options)
  const { chunks, docId } = input
  const total = chunks.length
  const partials: string[] = []

  for (let i = 0; i < total; i++) {
    try {
      const { text } = await generate(buildSectionPrompt({ chunk: chunks[i], docId }))
      const trimmed = text.trim()
      if (trimmed !== '') partials.push(trimmed)
    } catch {
      // A failed section is skipped, not fatal.
    }
    options.onProgress?.({ done: i + 1, total })
  }

  if (partials.length === 0) {
    throw new Error('no sections could be summarized on-device')
  }

  const { text } = await generate(buildReducePrompt({ docId, partials }))
  return { summary: text.trim(), partials }
}
