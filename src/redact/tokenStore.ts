import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { TokenMap } from './types'

/**
 * Token map storage — IndexedDB, on-device only.
 *
 * Hard rule 3: the token map ([NAME_1] -> real value) NEVER leaves the
 * device. This module must not import anything from Firebase; a guard test
 * (tests/redact/brand.test.ts) pins that.
 */

interface SafeDocsDB extends DBSchema {
  tokenMaps: {
    key: string
    value: {
      docId: string
      tokenMap: TokenMap
      savedAt: number
    }
  }
}

const DB_NAME = 'safedocs'
const DB_VERSION = 1

let dbPromise: Promise<IDBPDatabase<SafeDocsDB>> | undefined

function getDb(): Promise<IDBPDatabase<SafeDocsDB>> {
  dbPromise ??= openDB<SafeDocsDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('tokenMaps')) {
        db.createObjectStore('tokenMaps', { keyPath: 'docId' })
      }
    },
  })
  return dbPromise
}

/** Persist the token map for a document (device only). */
export async function saveTokenMap(docId: string, tokenMap: TokenMap): Promise<void> {
  const db = await getDb()
  await db.put('tokenMaps', { docId, tokenMap, savedAt: Date.now() })
}

/** Load the token map for a document, or null. */
export async function getTokenMap(docId: string): Promise<TokenMap | null> {
  const db = await getDb()
  const record = await db.get('tokenMaps', docId)
  return record?.tokenMap ?? null
}

/** Delete the token map for a document (e.g. user removes the document). */
export async function deleteTokenMap(docId: string): Promise<void> {
  const db = await getDb()
  await db.delete('tokenMaps', docId)
}
