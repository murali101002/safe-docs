/**
 * Chunking for local retrieval.
 *
 * Splits document text into overlapping chunks of roughly 400 tokens
 * (~300 whitespace words; MiniLM's effective input is well past this, so
 * chunks stay focused). Chunking is line-based because lines come from
 * grouped PDF rows and each line knows its page — chunks keep the page
 * numbers so answers can cite [doc, page].
 */

export interface Chunk {
  /** Stable id: `${docId}#${index}` — also the embedding cache key. */
  id: string
  docId: string
  index: number
  text: string
  /** Half-open line range [lineStart, lineEnd) into the source lines. */
  lineStart: number
  lineEnd: number
  /** Unique, sorted page numbers covered by this chunk. */
  pages: number[]
}

export interface ChunkInput {
  docId: string
  lines: string[]
  /** linePages[i] is the page of lines[i]; defaults to page 1. */
  linePages?: number[]
}

/** Target chunk size in whitespace words (~400 tokens). */
export const TARGET_WORDS = 300
/** Overlap carried into the next chunk, in words. */
export const OVERLAP_WORDS = 50

function wordCount(line: string): number {
  const trimmed = line.trim()
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length
}

export function chunkLines(input: ChunkInput): Chunk[] {
  const { docId, lines } = input
  const linePages = input.linePages ?? lines.map(() => 1)
  const words = lines.map(wordCount)

  const chunks: Chunk[] = []
  let start = 0
  while (start < lines.length) {
    // Extend the chunk until the word budget is met (or lines run out).
    let end = start
    let total = 0
    while (end < lines.length && total < TARGET_WORDS) {
      total += words[end]
      end++
    }

    const text = lines.slice(start, end).join('\n').trim()
    if (text !== '') {
      chunks.push({
        id: `${docId}#${chunks.length}`,
        docId,
        index: chunks.length,
        text,
        lineStart: start,
        lineEnd: end,
        pages: [...new Set(linePages.slice(start, end))].sort((a, b) => a - b),
      })
    }

    // Carry trailing lines (up to OVERLAP_WORDS) into the next chunk — but
    // never the entire chunk, so progress is always made.
    let carryStart = end
    let carryTotal = 0
    while (carryStart - 1 >= start && carryTotal + words[carryStart - 1] <= OVERLAP_WORDS) {
      carryStart--
      carryTotal += words[carryStart]
    }
    const overlapStart = carryStart > start ? carryStart : end
    start = Math.max(overlapStart, start + 1)
  }
  return chunks
}
