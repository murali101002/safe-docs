import type { Chunk } from '../retrieval/chunk'
import type { LabResult } from '../labs/parseRows'

/**
 * Opt-in sync of REDACTED content to Firestore (feature 07).
 *
 * Hard rule 3: Firestore stores redacted content only. The payload here is
 * built from the approved redacted text (chunks are cut from it) and the
 * structured lab rows — never the token map, never raw values, never
 * original PDFs. A guard test pins the payload shape.
 *
 * The Firestore adapter is injectable so tests can verify the payload
 * without an emulator.
 */

export interface SyncAdapter {
  /** Writes to the given path segments (e.g. users/{uid}/documents/{docId}). */
  setDoc(path: string[], data: Record<string, unknown>): Promise<void>
}

export interface SyncPayloadInput {
  docId: string
  label: string
  docDate: string | null
  /** Chunks cut from the approved redacted text. */
  chunks: Chunk[]
  labResults: LabResult[]
}

export interface SyncedDocument {
  docLabel: string
  docDate: string | null
  chunks: Array<{ id: string; text: string; pages: number[] }>
  labRows: LabResult[]
  syncedAt: number
}

/** Build the redacted-only payload that may be synced. */
export function buildSyncPayload(input: SyncPayloadInput): {
  docId: string
  document: SyncedDocument
} {
  return {
    docId: input.docId,
    document: {
      docLabel: input.label,
      docDate: input.docDate,
      chunks: input.chunks.map((chunk) => ({
        id: chunk.id,
        text: chunk.text,
        pages: chunk.pages,
      })),
      labRows: input.labResults,
      syncedAt: Date.now(),
    },
  }
}

/** Production adapter: Firestore via the modular SDK (lazy imports). */
export async function firebaseSyncAdapter(): Promise<SyncAdapter> {
  const { doc, setDoc } = await import('firebase/firestore')
  const { getFirebase } = await import('../firebase')
  const db = getFirebase().db
  return {
    async setDoc(path, data) {
      // doc(db, path, ...segments) — spread confuses the overloads, so
      // split explicitly.
      const [first, ...rest] = path
      await setDoc(doc(db, first, ...rest), data)
    },
  }
}

/** Sync one approved document to users/{uid}/documents/{docId}. */
export async function syncDocument(
  adapter: SyncAdapter,
  userId: string,
  input: SyncPayloadInput,
): Promise<void> {
  const { docId, document } = buildSyncPayload(input)
  await adapter.setDoc(['users', userId, 'documents', docId], document as unknown as Record<string, unknown>)
}
