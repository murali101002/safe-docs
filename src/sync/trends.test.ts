import { describe, expect, it } from 'vitest'
import { chartableTests, groupByTest, type TrendRow } from '../../src/sync/trends'
import type { LabResult } from '../../src/labs/parseRows'

function row(
  test: string,
  value: number | null,
  docId: string,
  docDate: string | null,
): TrendRow {
  const result: LabResult = {
    test,
    value,
    unit: 'mg/dL',
    refLow: null,
    refHigh: null,
    refText: null,
    flag: null,
    page: 1,
  }
  return { result, docId, docDate }
}

describe('groupByTest', () => {
  it('groups case-insensitively, drops undated rows, sorts by date', () => {
    const groups = groupByTest([
      row('Hemoglobin A1c', 5.9, 'jan::1', '2026-01-15'),
      row('hemoglobin a1c ', 6.3, 'mar::2', '2026-03-15'),
      row('Hemoglobin A1c', 6.7, 'nodate::3', null),
      row('Glucose (Fasting)', 98, 'jan::1', '2026-01-15'),
      row('Glucose (Fasting)', 112, 'mar::2', '2026-03-15'),
    ])
    expect([...groups.keys()]).toEqual(['hemoglobin a1c', 'glucose (fasting)'])
    const a1c = groups.get('hemoglobin a1c') ?? []
    expect(a1c.map((r) => r.sortDate)).toEqual(['2026-01-15', '2026-03-15'])
    expect(a1c.every((r) => r.result.value !== null)).toBe(true)
  })
})

describe('chartableTests', () => {
  it('lists only tests with two or more dated results', () => {
    const chartable = chartableTests([
      row('Hemoglobin A1c', 5.9, 'a', '2026-01-15'),
      row('Hemoglobin A1c', 6.3, 'b', '2026-03-15'),
      row('Creatinine', 1.3, 'a', '2026-01-15'),
      row('Potassium', 4.2, 'a', '2026-01-15'),
    ])
    expect(chartable).toEqual([{ key: 'hemoglobin a1c', label: 'Hemoglobin A1c' }])
  })
})
