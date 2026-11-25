import { describe, expect, it } from 'vitest'
import { buildExplainPrompt, explainLabValue } from './explain'
import type { LabResult } from '../labs/parseRows'

const row: LabResult = {
  test: 'Hemoglobin A1c',
  value: 6.7,
  unit: '%',
  refLow: 4,
  refHigh: 5.6,
  refText: '4.0-5.6',
  flag: 'H',
  page: 1,
}

describe('buildExplainPrompt', () => {
  it('includes the value, range, flag meaning, and citation', () => {
    const prompt = buildExplainPrompt({
      result: row,
      docId: 'report.pdf::1',
      docDate: '2026-01-15',
    })
    expect(prompt).toContain('Test: Hemoglobin A1c')
    expect(prompt).toContain('Value: 6.7 %')
    expect(prompt).toContain('Reference range: 4 to 5.6')
    expect(prompt).toContain('flagged HIGH')
    expect(prompt).toContain('NEVER diagnose')
    expect(prompt).toContain('[report.pdf, page 1]')
    expect(prompt).toContain('Collected: 2026-01-15')
  })

  it('uses the printed refText for one-sided ranges', () => {
    const lipid: LabResult = { ...row, test: 'LDL Cholesterol (calc)', value: 110, unit: 'mg/dL', refLow: null, refHigh: 100, refText: '<100', flag: 'H' }
    const prompt = buildExplainPrompt({ result: lipid, docId: 'd::1' })
    expect(prompt).toContain('Reference range: <100')
  })

  it('describes an unflagged value', () => {
    const normal: LabResult = { ...row, flag: null }
    const prompt = buildExplainPrompt({ result: normal, docId: 'd::1' })
    expect(prompt).toContain('No flag was printed')
  })
})

describe('explainLabValue (on-device, injectable)', () => {
  it('returns the trimmed explanation', async () => {
    const { text } = await explainLabValue(
      { result: row, docId: 'report.pdf::1' },
      {
        generate: async (prompt) => {
          expect(prompt).toContain('Explain this lab result:')
          return { text: '  A1C reflects average blood sugar over ~3 months.  ' }
        },
      },
    )
    expect(text).toBe('A1C reflects average blood sugar over ~3 months.')
  })
})
