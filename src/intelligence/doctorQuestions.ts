import { z } from 'zod'
import type { LabResult } from '../labs/parseRows'
import { resolveGenerate, SAFETY_RULES, type IntelligenceOptions } from './options'

/**
 * "Questions for my doctor": 3-5 specific, plain-language questions
 * generated on-device from the flagged lab rows. Strict JSON, zod-validated,
 * bad output discarded.
 */

const QuestionSchema = z.string().trim().min(10).max(240)

const MIN_QUESTIONS = 3
const MAX_QUESTIONS = 5

export interface DoctorQuestionsInput {
  /** Flagged rows (H or L) to ask about. */
  flagged: LabResult[]
  docId: string
}

export function buildDoctorQuestionsPrompt(input: DoctorQuestionsInput): string {
  const rows = input.flagged.map((result) => {
    const range =
      result.refLow !== null && result.refHigh !== null
        ? `${result.refLow}-${result.refHigh}`
        : (result.refText ?? 'no printed range')
    return `${result.test}: ${result.value ?? 'n/a'} ${result.unit ?? ''} ` +
      `(flag ${result.flag ?? '?'}, range ${range}, page ${result.page})`
  })
  return [
    SAFETY_RULES,
    '- The patient wants useful, specific questions to bring to their doctor appointment.',
    '- Questions must be about understanding and following up on these flagged results (causes to consider, other tests, lifestyle, urgency, medication questions) — never about getting a diagnosis from you.',
    '',
    'Flagged lab values:',
    rows.join('\n'),
    '',
    `Return ONLY a JSON array of ${MIN_QUESTIONS} to ${MAX_QUESTIONS} question strings —`,
    'no prose, no markdown fences. Each question 10-240 characters, plain language.',
  ].join('\n')
}

export function extractJsonArray(text: string): unknown {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('no JSON array in on-device output')
  }
  return JSON.parse(text.slice(start, end + 1))
}

export interface DoctorQuestionsResult {
  questions: string[]
  /** Rows whose output failed validation and was dropped. */
  discarded: number
}

/** Generate 3-5 doctor questions from flagged rows, on-device. */
export async function questionsForDoctor(
  input: DoctorQuestionsInput,
  options: IntelligenceOptions = {},
): Promise<DoctorQuestionsResult> {
  if (input.flagged.length === 0) {
    return { questions: [], discarded: 0 }
  }
  const generate = resolveGenerate(options)
  const { text } = await generate(buildDoctorQuestionsPrompt(input))

  let parsed: unknown
  try {
    parsed = extractJsonArray(text)
  } catch {
    return { questions: [], discarded: input.flagged.length }
  }
  if (!Array.isArray(parsed)) {
    return { questions: [], discarded: input.flagged.length }
  }

  const questions: string[] = []
  const seen = new Set<string>()
  let discarded = 0
  for (const item of parsed) {
    const checked = QuestionSchema.safeParse(item)
    if (!checked.success) {
      discarded++
      continue
    }
    const key = checked.data.toLowerCase()
    if (seen.has(key)) {
      discarded++
      continue
    }
    seen.add(key)
    questions.push(checked.data)
    if (questions.length >= MAX_QUESTIONS) break
  }
  return { questions, discarded }
}
