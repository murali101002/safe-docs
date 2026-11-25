import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import {
  buildSyncPayload,
  syncDocument,
  type SyncAdapter,
} from '../../src/sync/firestoreSync'
import { deleteApprovedDoc, listApprovedDocs, saveApprovedDoc } from '../../src/sync/docStore'
import { chunkLines } from '../../src/retrieval/chunk'
import type { LabResult } from '../../src/labs/parseRows'

const REDACTED = 'Patient: [NAME_1]\nDOB: [DOB_1]\nHemoglobin 13.5 g/dL 12.0-15.5'
const chunks = chunkLines({ docId: 'doc-1', lines: REDACTED.split('\n') })
const labRows: LabResult[] = [
  {
    test: 'Hemoglobin',
    value: 13.5,
    unit: 'g/dL',
    refLow: 12,
    refHigh: 15.5,
    refText: '12.0-15.5',
    flag: 'N',
    page: 1,
  },
]

describe('buildSyncPayload (redacted content only)', () => {
  const payload = buildSyncPayload({
    docId: 'doc-1',
    label: 'report.pdf',
    docDate: '2026-01-15',
    chunks,
    labResults: labRows,
  })

  it('chunks are cut from the redacted text', () => {
    expect(payload.document.chunks.length).toBeGreaterThan(0)
    for (const chunk of payload.document.chunks) {
      expect(chunk.text).toContain('[NAME_1]')
      expect(chunk.text).not.toContain('Jane Testpatient')
    }
  })

  it('carries structured lab rows and metadata, never the token map', () => {
    expect(payload.document.labRows).toEqual(labRows)
    expect(payload.document.docLabel).toBe('report.pdf')
    expect(payload.document.docDate).toBe('2026-01-15')
    expect(Object.keys(payload.document)).not.toContain('tokenMap')
  })

  it('targets users/{uid}/documents/{docId}', async () => {
    const writes: Array<{ path: string[]; data: unknown }> = []
    const adapter: SyncAdapter = {
      async setDoc(path, data) {
        writes.push({ path, data })
      },
    }
    await syncDocument(adapter, 'user-42', {
      docId: 'doc-1',
      label: 'report.pdf',
      docDate: '2026-01-15',
      chunks,
      labResults: labRows,
    })
    expect(writes).toHaveLength(1)
    expect(writes[0].path).toEqual(['users', 'user-42', 'documents', 'doc-1'])
    const data = writes[0].data as Record<string, unknown>
    expect(Object.keys(data)).toEqual(
      expect.arrayContaining(['docLabel', 'docDate', 'chunks', 'labRows', 'syncedAt']),
    )
    expect(JSON.stringify(data)).not.toContain('Jane Testpatient')
  })
})

describe('docStore (local registry)', () => {
  it('saves, lists newest-first, and deletes', async () => {
    await saveApprovedDoc({
      docId: 'old::1',
      label: 'old.pdf',
      docDate: '2026-01-15',
      redactedText: 'a',
      labResults: [],
    })
    await saveApprovedDoc({
      docId: 'new::2',
      label: 'new.pdf',
      docDate: '2026-03-15',
      redactedText: 'b',
      labResults: labRows,
    })
    const docs = await listApprovedDocs()
    expect(docs.map((d) => d.docId)).toEqual(['new::2', 'old::1'])
    expect(docs[0].labResults).toEqual(labRows)

    await deleteApprovedDoc('old::1')
    await deleteApprovedDoc('new::2')
    expect(await listApprovedDocs()).toEqual([])
  })
})
