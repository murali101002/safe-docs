import type { Chunk } from '../retrieval/chunk'
import type { LabHit } from '../retrieval/search'
import { resolveGenerate, SAFETY_RULES, type IntelligenceOptions } from './options'

/**
 * On-device Q&A over retrieved chunks with [doc, page] citations.
 */

/** Short display label for a document id ("report.pdf::123" -> "report.pdf"). */
export function docLabelOf(docId: string): string {
  return docId.split('::')[0] ?? docId
}

export interface QaPromptInput {
  question: string
  chunks: Chunk[]
  labHits: LabHit[]
}

/** Build the Q&A prompt from the retrieved context. */
export function buildQaPrompt(input: QaPromptInput): string {
  const sources = input.chunks.map((chunk) => {
    const pages = chunk.pages.join(', ')
    return `[SOURCE: ${docLabelOf(chunk.docId)}, page ${pages}]\n${chunk.text}`
  })
  const labLines = input.labHits.map(
    (hit) =>
      `${hit.result.test}: ${hit.result.value ?? 'n/a'} ${hit.result.unit ?? ''}` +
      `${hit.result.flag ? ` (${hit.result.flag})` : ''}` +
      ` — ${docLabelOf(hit.docId)}, page ${hit.result.page}` +
      `${hit.docDate ? `, collected ${hit.docDate}` : ''}`,
  )
  return [
    SAFETY_RULES,
    '- Cite every claim with its source, formatted exactly like [report.pdf, page 2].',
    '',
    'Structured lab rows found for this question:',
    labLines.length > 0 ? labLines.join('\n') : '(none)',
    '',
    'Document sections that may help:',
    sources.length > 0 ? sources.join('\n\n') : '(no sections retrieved)',
    '',
    `Question: ${input.question}`,
    '',
    'Answer with citations. If the sections and lab rows above do not contain',
    'the answer, say what is missing instead of guessing.',
  ].join('\n')
}

/** Pattern for instructed citations like "[report.pdf, page 2]". */
export const CITATION_PATTERN = /\[[^\]\n]{1,80},\s*page\s*\d+[^\]\n]{0,20}\]/i

/** Whether an answer contains at least one [doc, page N] citation. */
export function hasCitation(text: string): boolean {
  return CITATION_PATTERN.test(text)
}

export interface AnswerCheck {
  ok: boolean
  reason?: 'empty' | 'no citation'
}

/**
 * Quality gate for answers (the F7 router reuses this to decide whether to
 * retry or fall back): empty answers and uncited answers fail.
 */
export function checkAnswer(
  text: string,
  options: { chunksProvided: boolean },
): AnswerCheck {
  if (text.trim() === '') return { ok: false, reason: 'empty' }
  if (options.chunksProvided && !hasCitation(text)) {
    return { ok: false, reason: 'no citation' }
  }
  return { ok: true }
}

/** Disclaimer appended to every displayed answer (client-side, reliable). */
export const ANSWER_DISCLAIMER =
  'Informational only — not medical advice. Discuss results with your clinician.'

export interface AnswerResult {
  text: string
  ranOn: 'device'
  /** Present when the answer failed the quality gate. */
  problem?: 'empty' | 'no citation'
}

/**
 * Answer a question using only the retrieved on-device context.
 * Runs on the on-device model exclusively.
 */
export async function answerQuestion(
  input: QaPromptInput,
  options: IntelligenceOptions = {},
): Promise<AnswerResult> {
  const generate = resolveGenerate(options)
  const { text } = await generate(buildQaPrompt(input))
  const trimmed = text.trim()
  const check = checkAnswer(trimmed, { chunksProvided: input.chunks.length > 0 })
  return {
    text: trimmed,
    ranOn: 'device',
    problem: check.ok ? undefined : check.reason,
  }
}
