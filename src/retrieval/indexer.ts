import type { Chunk } from './chunk'
import { hashText, getEmbedding, putEmbedding } from './embedCache'
import type { Embedder } from './embedder'

/**
 * Index orchestration: compute (or load from the on-device cache) one
 * normalized vector per chunk. Vectors only ever live in memory and
 * IndexedDB — they are never uploaded.
 */

export interface BuildResult {
  vectors: Map<string, Float32Array>
  /** Number of chunks embedded fresh in this run (cache misses). */
  computed: number
  /** Number of chunks served from the on-device cache. */
  cached: number
}

/** Embed every chunk, using the IndexedDB cache first. */
export async function buildIndex(
  chunks: Chunk[],
  embedder: Embedder,
): Promise<BuildResult> {
  const vectors = new Map<string, Float32Array>()
  const misses: Chunk[] = []
  const cachedIds: Array<{ chunk: Chunk; vector: Float32Array }> = []

  for (const chunk of chunks) {
    const hash = hashText(chunk.text)
    const cached = await getEmbedding(chunk.id, hash)
    if (cached !== null) {
      vectors.set(chunk.id, cached)
      cachedIds.push({ chunk, vector: cached })
    } else {
      misses.push(chunk)
    }
  }

  if (misses.length > 0) {
    const fresh = await embedder.embed(misses.map((chunk) => chunk.text))
    if (fresh.length !== misses.length) {
      throw new Error(
        `embedder returned ${fresh.length} vectors for ${misses.length} chunks`,
      )
    }
    for (let i = 0; i < misses.length; i++) {
      const chunk = misses[i]
      const vector = fresh[i]
      vectors.set(chunk.id, vector)
      await putEmbedding(chunk.id, hashText(chunk.text), vector)
    }
  }

  return { vectors, computed: misses.length, cached: chunks.length - misses.length }
}

/** Embed a single query text. */
export async function embedQuery(
  query: string,
  embedder: Embedder,
): Promise<Float32Array> {
  const [vector] = await embedder.embed([query])
  if (vector === undefined) throw new Error('embedder returned no vector for the query')
  return vector
}
