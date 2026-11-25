import { describe, expect, it } from 'vitest'
import {
  buildDoctorQuestionsPrompt,
  questionsForDoctor,
} from './doctorQuestions'
import type { LabResult } from '../labs/parseRows'

const flagged: LabResult[] = [
  {
    test: 'Hemoglobin A1c',
    value: 6.7,
    unit: '%',
    refLow: 4,
    refHigh: 5.6,
    refText: '4.0-5.6',
    flag: 'H',
    page: 1,
  },
  {
    test: 'LDL Cholesterol (calc)',
    value: 110,
    unit: 'mg/dL',
    refLow: null,
    refHigh: 100,
    refText: '<100',
    flag: 'H',
    page: 1,
  },
]

describe('buildDoctorQuestionsPrompt', () => {
  it('lists flagged rows with ranges and asks for strict JSON', () => {
    const prompt = buildDoctorQuestionsPrompt({ flagged, docId: 'd::1' })
    expect(prompt).toContain('Hemoglobin A1c: 6.7 % (flag H, range 4-5.6, page 1)')
    expect(prompt).toContain('LDL Cholesterol (calc): 110 mg/dL (flag H, range <100, page 1)')
    expect(prompt).toContain('Return ONLY a JSON array of 3 to 5')
    expect(prompt).toContain('NEVER diagnose')
  })

  it('never asks when nothing is flagged', async () => {
    let called = false
    const { questions, discarded } = await questionsForDoctor(
      { flagged: [], docId: 'd::1' },
      { generate: async () => { called = true; return { text: '[]' } } },
    )
    expect(called).toBe(false)
    expect(questions).toEqual([])
    expect(discarded).toBe(0)
  })
})

describe('questionsForDoctor (zod-validated)', () => {
  it('keeps valid unique questions, caps at five, drops invalid', async () => {
    const valid = [
      'What could be raising my A1C?',
      'Should I repeat the A1C test soon?',
      'Does this LDL level change my heart risk plan?',
      'What diet changes would help my numbers?',
      'How urgent is this follow-up?',
      'Number six beyond the cap that should be dropped because of the limit',
    ]
    const { questions, discarded } = await questionsForDoctor(
      { flagged, docId: 'd::1' },
      { generate: async () => ({ text: JSON.stringify([valid[0], { bad: 1 }, valid[1], valid[0], '', valid[2], valid[3], valid[4], valid[5]]) }) },
    )
    expect(questions).toEqual(valid.slice(0, 5))
    expect(discarded).toBe(3) // bad shape + duplicate + empty (the 6th is never processed)
  })

  it('discards everything when the output is not JSON', async () => {
    const { questions, discarded } = await questionsForDoctor(
      { flagged, docId: 'd::1' },
      { generate: async () => ({ text: 'Sorry, no JSON here.' }) },
    )
    expect(questions).toEqual([])
    expect(discarded).toBe(flagged.length)
  })

  it('normalizes nothing silently: short junk is discarded', async () => {
    const { questions } = await questionsForDoctor(
      { flagged, docId: 'd::1' },
      { generate: async () => ({ text: JSON.stringify(['Short!', 'This one is long enough to pass validation.']) }) },
    )
    expect(questions).toEqual(['This one is long enough to pass validation.'])
  })
})
