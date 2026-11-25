import { getDb, type StoredDocument } from '../storage/db'
import type { LabResult } from '../labs/parseRows'

/**
 * Local registry of approved documents (IndexedDB, on-device only).
 * Powers cross-document retrieval and the trend chart without any network.
 */

export type StoredDoc = StoredDocument

export interface SaveDocInput {
  docId: string
  label: string
  docDate: string | null
  redactedText: string
  labResults: LabResult[]
}

/** Save (or update) an approved document in the local registry. */
export async function saveApprovedDoc(input: SaveDocInput): Promise<void> {
  const db = await getDb()
  await db.put('documents', {
    docId: input.docId,
    label: input.label,
    docDate: input.docDate,
    redactedText: input.redactedText,
    labResults: input.labResults,
    approvedAt: Date.now(),
  })
}

/** All approved documents, newest first. */
export async function listApprovedDocs(): Promise<StoredDoc[]> {
  const db = await getDb()
  const all = await db.getAll('documents')
  return all.sort((a, b) => b.approvedAt - a.approvedAt)
}

/** Remove a document from the registry (token map cleanup is separate). */
export async function deleteApprovedDoc(docId: string): Promise<void> {
  const db = await getDb()
  await db.delete('documents', docId)
}
