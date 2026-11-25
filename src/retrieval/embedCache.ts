import { getDb } from '../storage/db'
import type { StoredEmbedding } from '../storage/db'

/**
 * Embedding cache — vectors live in IndexedDB, on-device only (hard rule 3).
 * Entries are keyed by chunk id and invalidated by a text hash, so a
 * re-approved document re-embeds only what changed.
 */

/** Fast non-cryptographic text hash (FNV-1a 32-bit) as hex. */
export function hashText(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** Store one chunk's vector, replacing any previous version. */
export async function putEmbedding(
  chunkId: string,
  textHash: string,
  vector: Float32Array,
): Promise<void> {
  const db = await getDb()
  await db.put('embeddings', { chunkId, textHash, vector })
}

/** Load one chunk's cached vector if the text still matches. */
export async function getEmbedding(
  chunkId: string,
  textHash: string,
): Promise<Float32Array | null> {
  const db = await getDb()
  const record: StoredEmbedding | undefined = await db.get('embeddings', chunkId)
  if (record === undefined || record.textHash !== textHash) return null
  return record.vector
}
