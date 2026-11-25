import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { TokenMap } from '../redact/types'

/**
 * Shared IndexedDB schema for everything that must never leave the device
 * (hard rule 3): redaction token maps and retrieval embeddings. This module
 * must never import Firebase — guard-tested in tests/redact/brand.test.ts
 * and tests/retrieval/guards.test.ts.
 */

export interface StoredTokenMap {
  docId: string
  tokenMap: TokenMap
  savedAt: number
}

export interface StoredEmbedding {
  chunkId: string
  /** Hash of the chunk text; a changed text invalidates the vector. */
  textHash: string
  vector: Float32Array
}

interface SafeDocsDB extends DBSchema {
  tokenMaps: {
    key: string
    value: StoredTokenMap
  }
  embeddings: {
    key: string
    value: StoredEmbedding
  }
}

export const DB_NAME = 'safedocs'
export const DB_VERSION = 2

let dbPromise: Promise<IDBPDatabase<SafeDocsDB>> | undefined

/** Open the shared database (idempotent, single instance per page). */
export function getDb(): Promise<IDBPDatabase<SafeDocsDB>> {
  dbPromise ??= openDB<SafeDocsDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('tokenMaps')) {
        db.createObjectStore('tokenMaps', { keyPath: 'docId' })
      }
      if (!db.objectStoreNames.contains('embeddings')) {
        db.createObjectStore('embeddings', { keyPath: 'chunkId' })
      }
    },
  })
  return dbPromise
}
