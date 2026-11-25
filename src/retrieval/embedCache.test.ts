import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { getEmbedding, hashText, putEmbedding } from './embedCache'

const V = Float32Array.from([0.1, 0.2, 0.3])

describe('embedding cache (IndexedDB, device-only)', () => {
  it('round-trips a vector and validates the text hash', async () => {
    await putEmbedding('chunk-1', hashText('hello world'), V)
    expect(await getEmbedding('chunk-1', hashText('hello world'))).toEqual(V)
    // Changed text invalidates the cached vector.
    expect(await getEmbedding('chunk-1', hashText('changed text'))).toBeNull()
  })

  it('returns null for unknown chunks', async () => {
    expect(await getEmbedding('missing-chunk', hashText('anything'))).toBeNull()
  })

  it('overwrites on re-put', async () => {
    await putEmbedding('chunk-overwrite', hashText('a'), V)
    const v2 = Float32Array.from([0.9, 0.8, 0.7])
    await putEmbedding('chunk-overwrite', hashText('a'), v2)
    expect(await getEmbedding('chunk-overwrite', hashText('a'))).toEqual(v2)
  })

  it('hashes differ per text and are stable', () => {
    expect(hashText('a')).toBe(hashText('a'))
    expect(hashText('a')).not.toBe(hashText('b'))
  })
})
