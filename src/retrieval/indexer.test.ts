import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { chunkLines } from '../../src/retrieval/chunk'
import { buildIndex, embedQuery } from '../../src/retrieval/indexer'
import { createEmbedder } from '../../src/retrieval/embedder'
import { rankChunks } from '../../src/retrieval/search'

/** Fake embedder: deterministic "bag of initials" vectors for tests. */
function fakeEmbed(texts: string[]): Promise<Float32Array[]> {
  return Promise.resolve(
    texts.map((text) => {
      const vector = new Float32Array(8)
      for (const word of text.toLowerCase().split(/\W+/)) {
        if (word === '') continue
        vector[word.charCodeAt(0) % 8] += 1
        vector[word.length % 8] += 0.5
      }
      return vector
    }),
  )
}

const docId = 'doc-1'

/** ~16 words per line, 24 lines -> more than one chunk. */
const LINES = Array.from({ length: 24 }, (_, i) => {
  const heads = [
    'Hemoglobin A1c 6.7 % 4.0-5.6 H',
    'Estimated average glucose 146 mg/dL <140',
    'Creatinine 1.3 mg/dL 0.6-1.2',
  ]
  const head = heads[i % 3]
  return `${head} filler words for the retrieval index line number ${i}`
})

describe('indexer (cache-first build)', () => {
  it('embeds all chunks and reuses the cache on a second run', async () => {
    const chunks = chunkLines({ docId, lines: LINES })
    expect(chunks.length).toBeGreaterThanOrEqual(2)
    const embedder = createEmbedder({ embed: fakeEmbed })
    const first = await buildIndex(chunks, embedder)
    expect(first.vectors.size).toBe(chunks.length)
    expect(first.computed).toBe(chunks.length)
    expect(first.cached).toBe(0)

    const second = await buildIndex(chunks, embedder)
    expect(second.computed).toBe(0)
    expect(second.cached).toBe(chunks.length)
    expect([...second.vectors.keys()]).toEqual([...first.vectors.keys()])
  })

  it('recomputes when the text changes (hash invalidation)', async () => {
    const chunks = chunkLines({ docId, lines: LINES })
    const embedder = createEmbedder({ embed: fakeEmbed })
    await buildIndex(chunks, embedder)
    const edited = chunks.map((c, i) =>
      i === 0 ? { ...c, text: `${c.text} EDITED` } : c,
    )
    const rerun = await buildIndex(edited, embedder)
    expect(rerun.computed).toBe(1)
    expect(rerun.cached).toBe(edited.length - 1)
  })

  it('rejects when the embedder returns the wrong count', async () => {
    const chunks = chunkLines({ docId, lines: LINES })
    const embedder = createEmbedder({ embed: async () => [] })
    await expect(buildIndex(chunks, embedder)).rejects.toThrow(/vectors for/)
  })

  it('embeds a query and retrieval works end to end (fake embedder)', async () => {
    const chunks = chunkLines({ docId, lines: LINES })
    const embedder = createEmbedder({ embed: fakeEmbed })
    const { vectors } = await buildIndex(chunks, embedder)
    const queryVector = await embedQuery('What was my A1C?', embedder)
    const ranked = rankChunks('What was my A1C?', chunks, vectors, queryVector)
    expect(ranked.length).toBeGreaterThan(0)
    // The chunk containing the A1C row should surface.
    expect(ranked[0].chunk.text).toContain('Hemoglobin A1c')
  })
})
