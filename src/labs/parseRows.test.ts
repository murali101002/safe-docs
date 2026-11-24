import { describe, expect, it } from 'vitest'
import {
  normalizeDate,
  parseDocDate,
  parseLabResults,
  parseRowsDetailed,
} from './parseRows'
import type { PdfTextItem } from '../pdf/extract'

/** Build one fake row: cells spread left-to-right at 80pt intervals. */
function row(page: number, ...cells: string[]): PdfTextItem[] {
  return cells.map((text, i) => ({ text, x: 100 + i * 80, y: 500, page }))
}

describe('parseLabResults', () => {
  it('parses a simple row and computes N from the range', () => {
    const results = parseLabResults([
      row(1, 'Hemoglobin', '13.5', 'g/dL', '12.0-15.5'),
    ])
    expect(results).toEqual([
      {
        test: 'Hemoglobin',
        value: 13.5,
        unit: 'g/dL',
        refLow: 12,
        refHigh: 15.5,
        refText: '12.0-15.5',
        flag: 'N',
        page: 1,
      },
    ])
  })

  it('computes H and L when the value falls outside the range', () => {
    const results = parseLabResults([
      row(1, 'Glucose', '105', 'mg/dL', '70-99'),
      row(1, 'eGFR', '58', 'mL/min', '>60'),
    ])
    expect(results.map((r) => r.flag)).toEqual(['H', 'L'])
    expect(results[1].refLow).toBe(60)
    expect(results[1].refHigh).toBeNull()
  })

  it('parses <200 / >40 one-sided references', () => {
    const results = parseLabResults([
      row(1, 'Total Cholesterol', '185', 'mg/dL', '<200'),
      row(1, 'HDL Cholesterol', '52', 'mg/dL', '>40'),
      row(1, 'LDL Cholesterol', '110', 'mg/dL', '<100'),
    ])
    expect(results[0].refLow).toBeNull()
    expect(results[0].refHigh).toBe(200)
    expect(results[0].flag).toBe('N')
    expect(results[1].refLow).toBe(40)
    expect(results[2].flag).toBe('H')
  })

  it('gives an explicit H/L/N letter precedence over the range', () => {
    // 13.5 is inside 12.0-15.5, but the report prints "H".
    const results = parseLabResults([
      row(1, 'Hemoglobin', '13.5 H', 'g/dL', '12.0-15.5'),
      row(1, 'TSH', '0.35', 'µU/mL', 'N', '0.45-4.50'),
    ])
    expect(results[0].flag).toBe('H')
    expect(results[0].value).toBe(13.5)
    expect(results[1].flag).toBe('N')
  })

  it('parses comma-grouped values and units inside the value cell', () => {
    const results = parseLabResults([
      row(1, 'WBC', '5,200 /µL', '4,000-11,000'),
    ])
    expect(results[0]).toMatchObject({
      test: 'WBC',
      value: 5200,
      unit: '/µL',
      refLow: 4000,
      refHigh: 11000,
      refText: '4,000-11,000',
      flag: 'N',
    })
  })

  it('wraps a name fragment before the value row into the test name', () => {
    const results = parseLabResults([
      row(1, 'White Blood'),
      row(1, 'Cell Count', '5.2', '10^3/µL', '4.0-11.0'),
    ])
    expect(results).toHaveLength(1)
    expect(results[0].test).toBe('White Blood Cell Count')
    expect(results[0].flag).toBe('N')
  })

  it('merges a continuation line after a result into its name', () => {
    const results = parseLabResults([
      row(1, 'Neutrophils', '2.1', '10^3/µL', '1.5-7.5'),
      row(1, '(Absolute)'),
    ])
    expect(results).toHaveLength(1)
    expect(results[0].test).toBe('Neutrophils (Absolute)')
  })

  it('splits a multi-column row into two results', () => {
    const results = parseLabResults([
      row(1, 'Glucose', '92', 'mg/dL', '70-99', 'Creatinine', '0.9', 'mg/dL', '0.6-1.2'),
    ])
    expect(results.map((r) => r.test)).toEqual(['Glucose', 'Creatinine'])
    expect(results[0].value).toBe(92)
    expect(results[1].value).toBe(0.9)
    expect(results[1].refHigh).toBe(1.2)
  })

  it('skips header, metadata, and section rows', () => {
    const detailed = parseRowsDetailed([
      row(1, 'Test', 'Result', 'Units', 'Reference Range'),
      row(1, 'Patient: Jane Testpatient'),
      row(1, 'COMPLETE BLOOD COUNT'),
      row(1, 'WBC', '12.5', '10^3/µL', '4.0-11.0'),
    ])
    expect(detailed.results.map((r) => r.test)).toEqual(['WBC'])
    expect(detailed.rowInfo.map((i) => i.outcome)).toEqual([
      'header',
      'metadata',
      'section',
      'result',
    ])
  })

  it('strictly rejects a value like "19:1" instead of guessing', () => {
    const detailed = parseRowsDetailed([
      row(1, 'Sodium', '139', 'mEq/L', '136-145'),
      row(1, 'BUN/Creatinine Ratio', '19:1'),
    ])
    expect(detailed.results.map((r) => r.test)).toEqual(['Sodium'])
    expect(detailed.rowInfo[1].outcome).toBe('skipped')
  })

  it('does not attach text-only junk rows to the previous result', () => {
    const detailed = parseRowsDetailed([
      row(1, 'Potassium', '4.2', 'mEq/L', '3.5-5.1'),
      // Both cells look like words; the row has no recognizable structure.
      row(1, 'Color', 'Yellow', 'and', 'something'),
    ])
    expect(detailed.results[0].test).toBe('Potassium')
    expect(detailed.rowInfo[1].outcome).toBe('skipped')
  })

  it('keeps rows without any value-like cell out of the results', () => {
    const results = parseLabResults([
      row(1, 'Hemoglobin'),
      row(1, '13.5'),
    ])
    // "Hemoglobin" becomes pending, then "13.5" is an orphan value with a
    // pending name — the pending row is consumed and merged.
    expect(results).toEqual([
      expect.objectContaining({ test: 'Hemoglobin', value: 13.5, flag: null }),
    ])
  })
})

describe('parseDocDate', () => {
  it('reads ISO, slash, and month-name dates, else null', () => {
    expect(parseDocDate([row(1, 'Collected: 2026-01-15')])).toBe('2026-01-15')
    expect(parseDocDate([row(1, 'Collected: 03/15/2026')])).toBe('2026-03-15')
    expect(parseDocDate([row(1, 'Reported: Mar 15, 2026')])).toBe('2026-03-15')
    expect(parseDocDate([row(1, 'Hemoglobin', '13.5')])).toBeNull()
  })

  it('normalizes dates via normalizeDate', () => {
    expect(normalizeDate('2026-01-15')).toBe('2026-01-15')
    expect(normalizeDate('1/5/2026')).toBe('2026-01-05')
    expect(normalizeDate('Jan 5, 2026')).toBe('2026-01-05')
    expect(normalizeDate('not a date')).toBeNull()
  })
})
