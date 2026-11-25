import { describe, expect, it } from 'vitest'
import { chunkLines, OVERLAP_WORDS, TARGET_WORDS, type ChunkInput } from './chunk'

function linesOf(...lines: string[]): ChunkInput {
  return { docId: 'doc-1', lines, linePages: lines.map((_, i) => (i < 3 ? 1 : 2)) }
}

describe('chunkLines', () => {
  it('returns [] for empty input', () => {
    expect(chunkLines({ docId: 'd', lines: [] })).toEqual([])
  })

  it('drops chunks that contain no text', () => {
    const chunks = chunkLines({ docId: 'd', lines: ['', '   ', ''] })
    expect(chunks).toEqual([])
  })

  it('keeps every line reachable across chunks (no content loss)', () => {
    const lines = Array.from({ length: 40 }, (_, i) => `Line ${i + 1} with some clinical text about labs.`)
    const chunks = chunkLines(linesOf(...lines))
    expect(chunks.length).toBeGreaterThan(1)
    // Every line index must fall inside at least one chunk's line range.
    for (let i = 0; i < lines.length; i++) {
      const covered = chunks.some((c) => i >= c.lineStart && i < c.lineEnd)
      expect(covered, `line ${i} must be covered`).toBe(true)
    }
  })

  it('caps chunk size near the token budget', () => {
    const lines = Array.from(
      { length: 60 },
      (_, i) => `word word word word word word word line ${i}`,
    ) // 9 words each
    const chunks = chunkLines(linesOf(...lines))
    for (const chunk of chunks) {
      const words = chunk.text.split(/\s+/).length
      // A single line may overshoot the budget; multi-line chunks must not.
      expect(words).toBeLessThanOrEqual(TARGET_WORDS + 9)
    }
  })

  it('carries an overlap into the next chunk', () => {
    const lines = Array.from(
      { length: 50 },
      (_, i) => `sentence ${i} alpha beta gamma delta epsilon zeta eta theta`,
    ) // 10 words each
    const chunks = chunkLines(linesOf(...lines))
    expect(chunks.length).toBeGreaterThanOrEqual(2)
    // The second chunk must repeat trailing lines of the first.
    const firstEnd = chunks[0].text.trim().split('\n').at(-1)
    expect(chunks[1].text).toContain(firstEnd ?? '')
    const overlapWords = chunks[1].lineStart
      ? chunks[1].text.split('\n').slice(0, chunks[1].lineEnd - chunks[1].lineStart).length
      : 0
    expect(overlapWords).toBeGreaterThan(0)
    // Overlap stays within budget (plus one line of slack).
    const overlapText = lines.slice(chunks[1].lineStart, chunks[0].lineEnd)
    const overlapTotal = overlapText.join(' ').split(/\s+/).filter(Boolean).length
    expect(overlapTotal).toBeLessThanOrEqual(OVERLAP_WORDS + 10)
  })

  it('does not loop forever on one huge line', () => {
    const big = Array.from({ length: 800 }, (_, i) => `w${i}`).join(' ')
    const chunks = chunkLines(linesOf(big, 'final line'))
    expect(chunks).toHaveLength(2)
    expect(chunks[0].text).toContain('w0')
    expect(chunks[1].text).toBe('final line')
  })

  it('assigns stable ids, indexes, and merged page numbers', () => {
    const lines = ['a', 'b', 'c', 'd']
    // linesOf gives the first 3 lines page 1 and the rest page 2.
    const chunks = chunkLines(linesOf(...lines))
    expect(chunks[0].id).toBe('doc-1#0')
    expect(chunks[0].index).toBe(0)
    expect(chunks[0].lineEnd - chunks[0].lineStart).toBe(4) // small doc = one chunk
    expect(chunks[0].pages).toEqual([1, 2])
    // With explicit pages spanning two pages:
    const two = chunkLines({ docId: 'd', lines, linePages: [1, 1, 2, 2] })
    expect(two[0].pages).toEqual([1, 2])
    // All-same-page input keeps a single page number.
    const one = chunkLines({ docId: 'd', lines, linePages: [1, 1, 1, 1] })
    expect(one[0].pages).toEqual([1])
  })
})
