import { describe, expect, it } from 'vitest'
import { groupRows, ROW_TOLERANCE, type PdfTextItem } from './extract'

/** Fake pdf.js-style items for one page with a small two-row table. */
const fixture: PdfTextItem[] = [
  // Header row (y = 700): "Test | Result | Range"
  { text: 'Test', x: 100, y: 700, page: 1 },
  { text: 'Result', x: 300, y: 700.5, page: 1 },
  { text: 'Range', x: 500, y: 699, page: 1 },
  // Data row (y = 680): "Hemoglobin | 13.5 | 12-16"
  { text: 'Hemoglobin', x: 100, y: 680, page: 1 },
  { text: '13.5', x: 300, y: 680, page: 1 },
  { text: '12-16', x: 500, y: 680.2, page: 1 },
  // A line beyond tolerance from the data row starts a new row
  { text: 'Notes', x: 100, y: 680 - (ROW_TOLERANCE * 2 + 1), page: 1 },
  // Same y as the row above but on page 2 — must not merge across pages
  { text: 'Page 2 only', x: 100, y: 680 - (ROW_TOLERANCE * 2 + 1), page: 2 },
]

describe('groupRows', () => {
  it('clusters items into rows by y and orders cells by x', () => {
    const rows = groupRows(fixture)
    expect(rows).toHaveLength(4)
    expect(rows[0].map((c) => c.text)).toEqual(['Test', 'Result', 'Range'])
    expect(rows[1].map((c) => c.text)).toEqual(['Hemoglobin', '13.5', '12-16'])
  })

  it('does not merge items on different pages sharing a baseline', () => {
    const rows = groupRows(fixture)
    expect(rows[2].map((c) => c.text)).toEqual(['Notes'])
    expect(rows[3].map((c) => c.text)).toEqual(['Page 2 only'])
    expect(new Set(rows[3].map((c) => c.page))).toEqual(new Set([2]))
  })

  it('keeps rows within tolerance together regardless of insertion order', () => {
    const shuffled = [fixture[1], fixture[4], fixture[0], fixture[3], fixture[2], fixture[5]]
    const rows = groupRows(shuffled)
    expect(rows).toHaveLength(2)
    expect(rows[1].map((c) => c.text)).toEqual(['Hemoglobin', '13.5', '12-16'])
  })

  it('returns an empty array for empty input', () => {
    expect(groupRows([])).toEqual([])
  })
})
