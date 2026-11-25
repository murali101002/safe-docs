import { describe, expect, it } from 'vitest'
import { chunkLines } from '../retrieval/chunk'
import type { LabHit } from '../retrieval/search'
import type { LabResult } from '../labs/parseRows'
import {
  answerQuestion,
  buildQaPrompt,
  checkAnswer,
  docLabelOf,
  hasCitation,
} from './qa'

const docId = 'report.pdf::123'
const chunks = chunkLines({
  docId,
  lines: [
    'Hemoglobin A1c 6.7 % 4.0-5.6 H filler words one two three four',
    'Estimated average glucose 146 mg/dL filler words five six seven eight',
  ],
})

const labRow: LabResult = {
  test: 'Hemoglobin A1c',
  value: 6.7,
  unit: '%',
  refLow: 4,
  refHigh: 5.6,
  refText: '4.0-5.6',
  flag: 'H',
  page: 1,
}
const labHits: LabHit[] = [{ result: labRow, docId, docDate: '2026-01-15', score: 1 }]

describe('docLabelOf', () => {
  it('strips the storage suffix from a doc id', () => {
    expect(docLabelOf('report.pdf::123')).toBe('report.pdf')
    expect(docLabelOf('plain.pdf')).toBe('plain.pdf')
  })
})

describe('buildQaPrompt', () => {
  it('includes the safety rules, citations instruction, and labeled sources', () => {
    const prompt = buildQaPrompt({
      question: 'What was my A1C?',
      chunks,
      labHits,
    })
    expect(prompt).toContain('NEVER diagnose')
    expect(prompt).toContain('[SOURCE: report.pdf, page 1]')
    expect(prompt).toContain('Cite every claim')
    expect(prompt).toContain('Hemoglobin A1c: 6.7 % (H) — report.pdf, page 1, collected 2026-01-15')
    expect(prompt).toContain('Question: What was my A1C?')
  })

  it('marks empty context explicitly instead of pretending', () => {
    const prompt = buildQaPrompt({ question: 'q', chunks: [], labHits: [] })
    expect(prompt).toContain('(none)')
    expect(prompt).toContain('(no sections retrieved)')
  })
})

describe('checkAnswer / hasCitation', () => {
  it('passes a cited answer when chunks were provided', () => {
    expect(
      checkAnswer('Your A1C was 6.7% [report.pdf, page 1].', { chunksProvided: true }),
    ).toEqual({ ok: true })
    expect(hasCitation('Your A1C was 6.7% [report.pdf, page 1].')).toBe(true)
  })

  it('fails an empty answer', () => {
    expect(checkAnswer('   ', { chunksProvided: true })).toEqual({
      ok: false,
      reason: 'empty',
    })
  })

  it('fails an uncited answer when chunks were provided', () => {
    expect(checkAnswer('Your A1C was 6.7%.', { chunksProvided: true })).toEqual({
      ok: false,
      reason: 'no citation',
    })
  })

  it('does not require a citation when no chunks were retrieved', () => {
    expect(checkAnswer('There is no lab data to review.', { chunksProvided: false })).toEqual({
      ok: true,
    })
  })
})

describe('answerQuestion (on-device, injectable generator)', () => {
  it('returns the model answer tagged as on-device', async () => {
    const result = await answerQuestion(
      { question: 'What was my A1C?', chunks, labHits },
      {
        generate: async (prompt) => {
          expect(prompt).toContain('What was my A1C?')
          return { text: 'Your Hemoglobin A1c was 6.7% [report.pdf, page 1].' }
        },
      },
    )
    expect(result).toEqual({
      text: 'Your Hemoglobin A1c was 6.7% [report.pdf, page 1].',
      ranOn: 'device',
    })
  })

  it('flags empty and uncited answers instead of showing them blindly', async () => {
    const empty = await answerQuestion(
      { question: 'q', chunks, labHits },
      { generate: async () => ({ text: '  ' }) },
    )
    expect(empty.problem).toBe('empty')
    const uncited = await answerQuestion(
      { question: 'q', chunks, labHits },
      { generate: async () => ({ text: 'Looks fine.' }) },
    )
    expect(uncited.problem).toBe('no citation')
  })
})
