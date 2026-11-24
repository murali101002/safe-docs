import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock firebase/firestore: every builder is a spy so tests can assert on
// collection paths and written payloads. The fake Firestore instance is
// just a marker object — none of the real SDK is touched.
vi.mock('firebase/firestore', () => ({
  collection: vi.fn((...parts: string[]) => ({ kind: 'collection', parts })),
  doc: vi.fn((...parts: string[]) => ({ kind: 'doc', parts })),
  addDoc: vi.fn(async () => ({ id: 'new-doc-id' })),
  deleteDoc: vi.fn(async () => undefined),
  getDocs: vi.fn(async () => ({ docs: [] })),
  orderBy: vi.fn((field: string, dir: string) => ({ field, dir })),
  query: vi.fn((source: unknown, ...filters: unknown[]) => ({
    source,
    filters,
  })),
  serverTimestamp: vi.fn(() => ({ kind: 'serverTimestamp' })),
}))

const {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
} = await import('firebase/firestore')
const { deleteDocument, documentsPath, listDocuments, saveDocument } =
  await import('./docs')

const db = { kind: 'fake-firestore' } as never
const uid = 'user-abc123'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('documentsPath', () => {
  it('scopes every helper to users/{uid}/documents', () => {
    expect(documentsPath(uid)).toEqual(['users', uid, 'documents'])
  })
})

describe('saveDocument', () => {
  it('writes redacted content to users/{uid}/documents with timestamps', async () => {
    const input = {
      fileName: 'lab-report.pdf',
      // Field name documents the invariant: redacted content only.
      redactedContent: 'Hemoglobin | 13.5 | 12-16',
      rowCount: 1,
    }

    const id = await saveDocument(db, uid, input)

    expect(id).toBe('new-doc-id')
    expect(collection).toHaveBeenCalledWith(db, 'users', uid, 'documents')
    expect(addDoc).toHaveBeenCalledTimes(1)
    const [ref, payload] = vi.mocked(addDoc).mock.calls[0]
    expect(ref).toEqual({
      kind: 'collection',
      parts: [db, 'users', uid, 'documents'],
    })
    expect(payload).toEqual({
      ...input,
      createdAt: { kind: 'serverTimestamp' },
      updatedAt: { kind: 'serverTimestamp' },
    })
    expect(serverTimestamp).toHaveBeenCalledTimes(2)
  })
})

describe('listDocuments', () => {
  it('queries the user collection ordered by createdAt descending', async () => {
    await listDocuments(db, uid)

    expect(collection).toHaveBeenCalledWith(db, 'users', uid, 'documents')
    expect(orderBy).toHaveBeenCalledWith('createdAt', 'desc')
    expect(query).toHaveBeenCalledTimes(1)
    expect(getDocs).toHaveBeenCalledTimes(1)
    // getDocs receives the exact object the mocked query builder returned.
    const [queried] = vi.mocked(getDocs).mock.calls[0]
    expect(queried).toBe(vi.mocked(query).mock.results[0]!.value)
  })

  it('maps snapshot docs to SavedDocument objects', async () => {
    vi.mocked(getDocs).mockResolvedValueOnce({
      docs: [
        {
          id: 'doc-1',
          data: () => ({
            fileName: 'scan.pdf',
            redactedContent: 'redacted…',
            rowCount: 3,
            createdAt: { kind: 'timestamp-1' },
            updatedAt: { kind: 'timestamp-2' },
          }),
        },
        {
          id: 'doc-2',
          // Missing timestamps (pending serverTimestamp) map to null.
          data: () => ({
            fileName: 'a.pdf',
            redactedContent: '',
            rowCount: 0,
          }),
        },
      ],
    } as never)

    const docs = await listDocuments(db, uid)

    expect(docs[0]).toEqual({
      id: 'doc-1',
      fileName: 'scan.pdf',
      redactedContent: 'redacted…',
      rowCount: 3,
      createdAt: { kind: 'timestamp-1' },
      updatedAt: { kind: 'timestamp-2' },
    })
    expect(docs[1].createdAt).toBeNull()
    expect(docs[1].updatedAt).toBeNull()
  })
})

describe('deleteDocument', () => {
  it('targets the exact user document path', async () => {
    await deleteDocument(db, uid, 'doc-9')

    expect(doc).toHaveBeenCalledWith(db, 'users', uid, 'documents', 'doc-9')
    expect(deleteDoc).toHaveBeenCalledWith({
      kind: 'doc',
      parts: [db, 'users', uid, 'documents', 'doc-9'],
    })
  })
})
