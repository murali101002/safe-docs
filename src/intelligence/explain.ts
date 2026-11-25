import type { LabResult } from '../labs/parseRows'
import { docLabelOf } from './qa'
import { resolveGenerate, SAFETY_RULES, type IntelligenceOptions } from './options'

/**
 * On-device explanations: what a lab value/term means, and what an
 * out-of-range (H/L) flag implies — always informational, never diagnostic.
 */

export interface ExplainInput {
  result: LabResult
  /** Document id the row came from (for the citation). */
  docId: string
  docDate?: string | null
}

export function buildExplainPrompt(input: ExplainInput): string {
  const { result } = input
  const range =
    result.refLow !== null && result.refHigh !== null
      ? `${result.refLow} to ${result.refHigh}`
      : (result.refText ?? 'the printed reference range')
  const flagText =
    result.flag === 'H'
      ? 'This value is flagged HIGH (above the reference range).'
      : result.flag === 'L'
        ? 'This value is flagged LOW (below the reference range).'
        : result.flag === 'N'
          ? 'This value is within the reference range.'
          : 'No flag was printed for this value.'
  return [
    SAFETY_RULES,
    '- Explain what the test measures, what the value means, and why a flag may matter.',
    '- You may describe in general terms what kinds of things commonly affect this test, but never conclude that the patient has a condition.',
    '- Cite the source as [' + docLabelOf(input.docId) + ', page ' + result.page + '].',
    '',
    `Explain this lab result:`,
    `Test: ${result.test}`,
    `Value: ${result.value ?? 'not numeric'} ${result.unit ?? ''}`.trim(),
    `Reference range: ${range}`,
    flagText,
    input.docDate ? `Collected: ${input.docDate}` : '',
    '',
    'Write 3-5 short sentences a patient can understand, ending with a note to',
    'discuss the result with the clinician.',
  ]
    .filter((line) => line !== '')
    .join('\n')
}

/** Explain one lab value/term on-device. */
export async function explainLabValue(
  input: ExplainInput,
  options: IntelligenceOptions = {},
): Promise<{ text: string }> {
  const generate = resolveGenerate(options)
  const { text } = await generate(buildExplainPrompt(input))
  return { text: text.trim() }
}
