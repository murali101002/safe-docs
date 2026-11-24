import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
} from 'firebase/firestore'
import type { Firestore, Timestamp } from 'firebase/firestore'

/**
 * Helpers for the per-user document store: users/{uid}/documents/{docId}.
 *
 * SECURITY (read this before touching these helpers):
 *   Only REDACTED content may be written to Firestore. The raw text
 *   extracted from a user's PDF must NEVER be written here — or anywhere
 *   else in the database. Callers are expected to pass content that has
 *   already gone through the redaction pipeline; these helpers deliberately
 *   accept a field named `redactedContent` (enforced again by
 *   firestore.rules) so that accidentally passing raw text requires
 *   overriding the type name, not just the value.
 */

export interface SavedDocumentInput {
  fileName: string
  /** Redacted extract only. Raw text must never be written to Firestore. */
  redactedContent: string
  rowCount: number
}

export interface SavedDocument extends SavedDocumentInput {
  id: string
  createdAt: Timestamp | null
  updatedAt: Timestamp | null
}

/** Collection path for a user's saved documents. */
export function documentsPath(uid: string): [string, string, string] {
  return ['users', uid, 'documents']
}

/** Saves a document and returns its new Firestore document ID. */
export async function saveDocument(
  db: Firestore,
  uid: string,
  input: SavedDocumentInput,
): Promise<string> {
  const ref = await addDoc(collection(db, ...documentsPath(uid)), {
    ...input,
    // serverTimestamp keeps client clocks out of the data model; rules
    // require both fields to be timestamps and createdAt to be immutable.
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return ref.id
}

/** Lists a user's saved documents, newest first. */
export async function listDocuments(
  db: Firestore,
  uid: string,
): Promise<SavedDocument[]> {
  const snapshot = await getDocs(
    query(collection(db, ...documentsPath(uid)), orderBy('createdAt', 'desc')),
  )
  return snapshot.docs.map((docSnap) => {
    const data = docSnap.data()
    return {
      id: docSnap.id,
      fileName: data.fileName,
      redactedContent: data.redactedContent,
      rowCount: data.rowCount,
      createdAt: (data.createdAt as Timestamp | undefined) ?? null,
      updatedAt: (data.updatedAt as Timestamp | undefined) ?? null,
    }
  })
}

/** Deletes one of a user's saved documents. */
export async function deleteDocument(
  db: Firestore,
  uid: string,
  documentId: string,
): Promise<void> {
  await deleteDoc(doc(db, ...documentsPath(uid), documentId))
}
