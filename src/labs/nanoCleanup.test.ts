import { describe, expect, it } from 'vitest'
import {
  cleanupUnparsedRows,
  extractJsonArray,
  findCleanupCandidates,
} from './nanoCleanup'
import type { PdfTextItem } from '../pdf/extract'

function row(page: number, ...cells: string[]): PdfTextItem[] {
  return cells.map((text, i) => ({ text, x: 100 + i * 80, y: 500, page }))
}

/** Rows the deterministic parser cannot read: word "values" and a ratio. */
function messyRows(): PdfTextItem[][] {
  return [
    row(1, 'COMPLETE BLOOD COUNT'),
    row(1, 'Color', 'Yellow'),
    row(1, 'Appearance', 'Clear'),
    row(1, 'Potassium', '4.2', 'mEq/L', '3.5-5.1'),
    row(1, 'BUN/Creatinine Ratio', '19:1'),
  ]
}

describe('findCleanupCandidates', () => {
  it('returns only rows the deterministic parser skipped or left pending', () => {
    const candidates = findCleanupCandidates(messyRows())
    const texts = candidates.map((info) => info.row.map((c) => c.text).join(' '))
    expect(texts).toEqual(['Color Yellow', 'Appearance Clear', 'BUN/Creatinine Ratio 19:1'])
  })

  it('returns nothing for clean rows', () => {
    expect(findCleanupCandidates([row(1, 'Potassium', '4.2', 'mEq/L', '3.5-5.1')])).toEqual([])
  })
})

describe('extractJsonArray', () => {
  it('tolerates markdown fences and prose around the JSON', () => {
    expect(extractJsonArray('```json\n[{"test":"Color"}]\n```')).toEqual([{ test: 'Color' }])
    expect(extractJsonArray('Here you go:\n[1,2] — done.')).toEqual([1, 2])
  })

  it('throws when there is no array', () => {
    expect(() => extractJsonArray('no json here')).toThrow()
    expect(() => extractJsonArray('[broken')).toThrow()
  })
})

describe('cleanupUnparsedRows', () => {
  const validReply = JSON.stringify([
    { test: 'Color', value: null, unit: null, refLow: null, refHigh: null, refText: null, flag: null },
    { test: 'Appearance', value: null, unit: null, refLow: null, refHigh: null, refText: null, flag: null },
    { test: 'BUN/Creatinine Ratio', value: null, unit: null, refLow: null, refHigh: null, refText: '19:1', flag: null },
  ])

  it('converts skipped rows using the injected generator', async () => {
    let receivedPrompt = ''
    const { results, discarded } = await cleanupUnparsedRows(messyRows(), {
      generate: async (prompt) => {
        receivedPrompt = prompt
        return { text: validReply }
      },
    })
    expect(discarded).toBe(0)
    expect(results).toHaveLength(3)
    expect(results[0]).toEqual({
      test: 'Color',
      value: null,
      unit: null,
      refLow: null,
      refHigh: null,
      refText: null,
      flag: null,
      page: 1,
    })
    // The prompt must ask for strict JSON only.
    expect(receivedPrompt).toContain('Return ONLY a JSON array')
    expect(receivedPrompt).toContain('ROW 1: Color | Yellow')
  })

  it('discards rows that fail zod validation instead of guessing', async () => {
    const reply = JSON.stringify([
      { test: 'Color', value: null, unit: null, refLow: null, refHigh: null, refText: null, flag: null },
      { test: 'Appearance', value: 'clear' }, // wrong shape
      { flag: 'H' }, // missing test
    ])
    const { results, discarded } = await cleanupUnparsedRows(messyRows(), {
      generate: async () => ({ text: reply }),
    })
    expect(results.map((r) => r.test)).toEqual(['Color'])
    expect(discarded).toBe(2)
  })

  it('discards the empty-test "not a result" marker rows', async () => {
    const reply = JSON.stringify([
      { test: '', value: null, unit: null, refLow: null, refHigh: null, refText: null, flag: null },
      { test: 'Appearance', value: null, unit: null, refLow: null, refHigh: null, refText: null, flag: null },
      { test: '', value: null, unit: null, refLow: null, refHigh: null, refText: null, flag: null },
    ])
    const { results, discarded } = await cleanupUnparsedRows(messyRows(), {
      generate: async () => ({ text: reply }),
    })
    expect(results.map((r) => r.test)).toEqual(['Appearance'])
    expect(discarded).toBe(2)
  })

  it('normalizes a lowercase flag letter', async () => {
    const reply = JSON.stringify([
      { test: 'Color', value: null, unit: null, refLow: null, refHigh: null, refText: null, flag: 'h' },
    ])
    const { results } = await cleanupUnparsedRows(messyRows(), {
      generate: async () => ({ text: reply }),
    })
    expect(results[0].flag).toBe('H')
  })

  it('discards everything when the output is not JSON', async () => {
    const candidates = findCleanupCandidates(messyRows()).length
    const { results, discarded } = await cleanupUnparsedRows(messyRows(), {
      generate: async () => ({ text: 'I could not understand the rows, sorry!' }),
    })
    expect(results).toEqual([])
    expect(discarded).toBe(candidates)
  })

  it('does nothing when there are no candidates', async () => {
    let called = false
    const { results, discarded } = await cleanupUnparsedRows(
      [row(1, 'Potassium', '4.2', 'mEq/L', '3.5-5.1')],
      {
        generate: async () => {
          called = true
          return { text: '[]' }
        },
      },
    )
    expect(called).toBe(false)
    expect(results).toEqual([])
    expect(discarded).toBe(0)
  })
})
