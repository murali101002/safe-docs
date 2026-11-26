import { useCallback, useEffect, useState } from 'react'
import './App.css'
import { AuthScreen } from './auth/AuthScreen'
import { useAuth } from './auth/useAuth'
import { StatusBanner } from './components/StatusBanner'
import { extractTextItems, groupRows } from './pdf/extract'
import { parseDocDate, parseLabResults, type LabResult } from './labs/parseRows'
import { LabResultsTable } from './labs/LabResultsTable'
import { isOnDeviceAvailable } from './ai/hybrid'
import { detectRedactions, approveRedactions, type ApprovedRedaction } from './redact/pipeline'
import { RedactionReview } from './redact/RedactionReview'
import { saveTokenMap } from './redact/tokenStore'
import type { RedactionSpan } from './redact/types'
import type { OcrRow } from './ocr/extract'
import { Onboarding, DisclaimerFooter, EmptyState } from './components/Onboarding'
import { createEmbedder, type Embedder } from './retrieval/embedder'
import { buildIndex } from './retrieval/indexer'
import { chunkLines, type Chunk } from './retrieval/chunk'
import { IntelligencePanel } from './intelligence/IntelligencePanel'
import { loadRouterConfig, ROUTER_DEFAULTS, type RouterConfig } from './ai/routerConfig'
import { askHybrid, type AskOutcome, type AskScopeDoc } from './ai/hybridAsk'
import { listApprovedDocs, saveApprovedDoc, type StoredDoc } from './sync/docStore'
import { firebaseSyncAdapter, syncDocument } from './sync/firestoreSync'
import { TrendsPanel } from './sync/TrendsPanel'
import {
  createAppScanQueue,
  requestScanPermissions,
  rowsToLabResults,
  rowsToText,
  type ScanQueue,
} from './ocr/scanFlow'
import { ScanPanel } from './ocr/ScanPanel'

/**
 * The transformers.js worker spawns on first use; keep one instance for the
 * whole session (module-level, not per render). Same for the scan queue.
 */
let sessionEmbedder: Embedder | null = null
function getEmbedder(): Embedder {
  sessionEmbedder ??= createEmbedder()
  return sessionEmbedder
}

let appScanQueue: ScanQueue | null = null
function getScanQueue(): ScanQueue {
  appScanQueue ??= createAppScanQueue()
  return appScanQueue
}

const SYNC_OPT_IN_KEY = 'safedocs_sync_opt_in'

function App() {
  const { user, loading, signOut } = useAuth()
  const [showAuth, setShowAuth] = useState(false)
  const [results, setResults] = useState<LabResult[]>([])
  const [docDate, setDocDate] = useState<string | null>(null)
  const [docId, setDocId] = useState<string | null>(null)
  const [docLabel, setDocLabel] = useState<string | null>(null)
  const [docText, setDocText] = useState<string | null>(null)
  const [spans, setSpans] = useState<RedactionSpan[]>([])
  const [removedIds, setRemovedIds] = useState<ReadonlySet<string>>(new Set())
  const [customSpans, setCustomSpans] = useState<RedactionSpan[]>([])
  const [approved, setApproved] = useState<ApprovedRedaction | null>(null)
  const [nanoNote, setNanoNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [parsing, setParsing] = useState(false)

  // On-device capability + router config.
  const [onDeviceAvailable, setOnDeviceAvailable] = useState<boolean | null>(null)
  const [config, setConfig] = useState<RouterConfig>(ROUTER_DEFAULTS)

  // Local document registry + opt-in cloud sync.
  const [docs, setDocs] = useState<StoredDoc[]>([])
  const [syncOptIn, setSyncOptIn] = useState<boolean>(
    () => localStorage.getItem(SYNC_OPT_IN_KEY) === 'true',
  )
  const [syncStatus, setSyncStatus] = useState<string | null>(null)

  // Retrieval index is owned by RetrievalSection (built per approved doc).

  // Last answer info for the banner.
  const [lastRun, setLastRun] = useState<{
    target: 'device' | 'cloud'
    cloudPreview?: string
  } | null>(null)

  // Photo scanning (feature 08).
  const [scanning, setScanning] = useState<string | null>(null)

  const refreshDocs = useCallback(async () => {
    setDocs(await listApprovedDocs())
  }, [])

  useEffect(() => {
    // Kick startup loads off after the render commits (queueMicrotask keeps
    // the setState calls out of the synchronous effect body).
    queueMicrotask(() => {
      void refreshDocs()
      void isOnDeviceAvailable()
        .then(setOnDeviceAvailable)
        .catch(() => setOnDeviceAvailable(false))
      void loadRouterConfig().then(setConfig)
    })
  }, [refreshDocs])

  useEffect(() => {
    localStorage.setItem(SYNC_OPT_IN_KEY, syncOptIn ? 'true' : 'false')
  }, [syncOptIn])

  const onRan = useCallback(
    (info: { target: 'device' | 'cloud'; cloudPreview?: string }) => {
      setLastRun({ target: info.target, cloudPreview: info.cloudPreview })
    },
    [],
  )

  /**
   * Hybrid ask: retrieval across ALL approved docs, routing, quality gate,
   * escalation, and local rehydration (see src/ai/hybridAsk.ts).
   */
  const ask = useCallback(
    async (question: string): Promise<AskOutcome> => {
      let scope: AskScopeDoc[] = docs.map((doc) => ({
        docId: doc.docId,
        docDate: doc.docDate,
        redactedText: doc.redactedText,
        labResults: doc.labResults,
      }))
      if (scope.length === 0 && approved !== null && docId !== null) {
        scope = [
          {
            docId,
            docDate,
            redactedText: approved.redacted.text,
            labResults: results,
          },
        ]
      }
      return askHybrid({
        question,
        scope,
        config,
        online: navigator.onLine,
        onDeviceAvailable: onDeviceAvailable ?? true,
        embedder: getEmbedder(),
      })
    },
    [docs, approved, docId, docDate, results, config, onDeviceAvailable],
  )

  // --- Conditional rendering starts here (all hooks above) ---

  if (loading) {
    return (
      <main>
        <h1>SafeDocs</h1>
        <p role="status">Checking sign-in…</p>
      </main>
    )
  }

  if (showAuth) {
    return <AuthScreen />
  }

  const trendRows = docs.flatMap((doc) =>
    doc.labResults.map((result) => ({ result, docId: doc.docId, docDate: doc.docDate })),
  )

  async function onFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    // Photo path: on-device OCR queue (never the cloud). PDF path: local
    // pdf.js extraction.
    if (file.type.startsWith('image/')) {
      setError(null)
      setParsing(false)
      void requestScanPermissions()
      getScanQueue().enqueue(file, file.name)
      setScanning(file.name)
      return
    }
    setError(null)
    setParsing(true)
    setApproved(null)
    try {
      const items = await extractTextItems(await file.arrayBuffer())
      const grouped = groupRows(items)
      const text = grouped.map((row) => row.map((c) => c.text).join(' ')).join('\n')
      const id = `${file.name}::${file.size}`
      setResults(parseLabResults(grouped))
      setDocDate(parseDocDate(grouped))
      setDocText(text)
      setDocId(id)
      setDocLabel(file.name)
      setRemovedIds(new Set())
      setCustomSpans([])

      // Layer 2 (names/addresses) needs Chrome's on-device model.
      let useNano = false
      try {
        useNano = await isOnDeviceAvailable()
      } catch {
        useNano = false
      }
      setOnDeviceAvailable(useNano)
      setNanoNote(
        useNano
          ? null
          : 'On-device AI is unavailable, so person names are not auto-detected. ' +
              'Redact them by selecting the text below.',
      )

      const detected = await detectRedactions(text, { useNano })
      setSpans(detected)
    } catch (err) {
      setResults([])
      setDocDate(null)
      setDocText(null)
      setDocId(null)
      setDocLabel(null)
      setSpans([])
      setError(err instanceof Error ? err.message : 'Failed to read PDF')
    } finally {
      setParsing(false)
    }
  }

  function toggleSpan(spanId: string) {
    setRemovedIds((prev) => {
      const next = new Set(prev)
      if (next.has(spanId)) next.delete(spanId)
      else next.add(spanId)
      return next
    })
  }

  function addCustomSpan(start: number, end: number) {
    const id = `c${customSpans.length}`
    setCustomSpans((prev) => [...prev, { id, start, end, type: 'CUSTOM' }])
  }

  /** Feed confirmed OCR rows into the normal redaction flow as a new doc. */
  async function onScanConfirm(rows: OcrRow[], label: string): Promise<void> {
    const id = `${label}::${Date.now()}`
    const text = rowsToText(rows)
    const labResults = rowsToLabResults(rows)
    setScanning(null)
    setDocId(id)
    setDocLabel(label)
    setDocDate(null)
    setDocText(text)
    setResults(labResults)
    setRemovedIds(new Set())
    setCustomSpans([])
    setApproved(null)
    // Redaction for the scanned page (Nano names layer when available).
    let useNano = false
    try {
      useNano = await isOnDeviceAvailable()
    } catch {
      useNano = false
    }
    const detected = await detectRedactions(text, { useNano })
    setSpans(detected)
  }

  async function onApprove() {
    if (docText === null || docId === null || docLabel === null) return
    const all = [...spans, ...customSpans]
    const approvedRedaction = approveRedactions(
      docText,
      docId,
      all,
      new Set(all.map((s) => s.id).filter((id) => !removedIds.has(id))),
    )
    // Token map + document stay on this device (IndexedDB). Nothing is
    // sent anywhere unless the user opted into sync.
    await saveTokenMap(docId, approvedRedaction.tokenMap)
    await saveApprovedDoc({
      docId,
      label: docLabel,
      docDate,
      redactedText: approvedRedaction.redacted.text,
      labResults: results,
    })
    await refreshDocs()
    if (user !== null && syncOptIn) {
      await syncCurrentDoc(approvedRedaction)
    }
    setApproved(approvedRedaction)
  }

  async function syncCurrentDoc(approvedRedaction: ApprovedRedaction): Promise<void> {
    if (user === null || docId === null || docLabel === null) return
    setSyncStatus('Syncing redacted content…')
    try {
      const docChunks = chunkLines({
        docId,
        lines: approvedRedaction.redacted.text.split('\n'),
      })
      await syncDocument(await firebaseSyncAdapter(), user.uid, {
        docId,
        label: docLabel,
        docDate,
        chunks: docChunks,
        labResults: results,
      })
      setSyncStatus('Synced redacted chunks + lab rows to your account.')
    } catch (err) {
      setSyncStatus(
        `Sync failed: ${err instanceof Error ? err.message : 'unknown error'} — ` +
          'your data stays local.',
      )
    }
  }

  return (
    <>
      <StatusBanner
        inference={lastRun?.target}
        onDeviceAvailable={onDeviceAvailable}
        cloudPreview={lastRun?.cloudPreview}
      />
      <main>
        <h1>SafeDocs</h1>
        <p>
          Privacy-first: your PDF is parsed locally, and anything that may
          contain personal information runs only on Chrome&apos;s on-device
          model. Cloud answers use approved redacted text only.
        </p>
        <p>
          {user ? (
            <>
              Signed in.{' '}
              <button type="button" onClick={() => void signOut()}>
                Sign out
              </button>
            </>
          ) : (
            <>
              Local-only mode — everything works on this computer.{' '}
              <button type="button" onClick={() => setShowAuth(true)}>
                Sign in
              </button>
            </>
          )}
        </p>

        <Onboarding />

        <label>
          <p>Choose a medical record PDF or a photo of one:</p>
          <input
            type="file"
            accept="application/pdf,image/*"
            onChange={onFileChange}
          />
        </label>

        {parsing && <p role="status">Reading document locally…</p>}
        {error && <p role="alert">{error}</p>}

        {scanning !== null && (
          <ScanPanel
            queue={getScanQueue()}
            pendingLabel={scanning}
            onConfirm={(rows, label) => void onScanConfirm(rows, label)}
            onCancel={() => setScanning(null)}
          />
        )}

        {docs.length > 0 && (
          <p className="review-hint">
            {docs.length} approved document{docs.length === 1 ? '' : 's'} on
            this device (search and trends cover all of them).
          </p>
        )}

        {docId === null && !parsing && <EmptyState />}

        {docId !== null && !parsing && (
          <>
            <p>
              <strong>{docLabel ?? docId.split('::')[0]}</strong>
              {docDate && <> — collected {docDate}</>} — {results.length} lab
              values parsed
            </p>

            <LabResultsTable results={results} />

            {nanoNote && <p role="status">{nanoNote}</p>}

            {approved ? (
              <>
                <section aria-labelledby="approved-heading" className="approved-box">
                  <h3 id="approved-heading">Redactions approved ✓</h3>
                  <p role="status">
                    The token map and document are stored only on this device.
                  </p>
                  {user ? (
                    <label className="sync-toggle">
                      <input
                        type="checkbox"
                        checked={syncOptIn}
                        onChange={(e) => setSyncOptIn(e.target.checked)}
                      />
                      Sync redacted chunks + lab rows to my Firebase account
                      (no token map, no raw values)
                    </label>
                  ) : (
                    <p className="review-hint">
                      Local-only mode — sign in to enable optional sync.
                    </p>
                  )}
                  {user !== null && syncOptIn && (
                    <p>
                      <button
                        type="button"
                        onClick={() => void syncCurrentDoc(approved)}
                      >
                        Sync this document now
                      </button>
                    </p>
                  )}
                  {syncStatus && <p role="status">{syncStatus}</p>}
                  <details>
                    <summary>See exactly what the cloud would receive</summary>
                    <pre className="redacted-preview">{approved.redacted.text}</pre>
                  </details>
                </section>

                <RetrievalSection
                  key={approved.redacted.docId}
                  docId={approved.redacted.docId}
                  docDate={docDate}
                  labResults={results}
                  approvedText={approved.redacted.text}
                  ask={ask}
                  onRan={onRan}
                  trendRows={trendRows}
                />
              </>
            ) : (
              docText !== null && (
                <RedactionReview
                  text={docText}
                  spans={[...spans, ...customSpans]}
                  removedIds={removedIds}
                  onToggle={toggleSpan}
                  onAddCustom={addCustomSpan}
                  onApprove={() => void onApprove()}
                />
              )
            )}
          </>
        )}
        </main>
      <DisclaimerFooter />
    </>
  )
}

/**
 * Builds the on-device retrieval index over the approved REDACTED text
 * (vectors live in IndexedDB on this device), then renders the intelligence
 * panel (routed ask) and the trend chart across all approved documents.
 */
function RetrievalSection({
  docId,
  docDate,
  labResults,
  approvedText,
  ask,
  onRan,
  trendRows,
}: {
  docId: string
  docDate: string | null
  labResults: LabResult[]
  approvedText: string
  ask: (question: string) => Promise<AskOutcome>
  onRan: (info: { target: 'device' | 'cloud'; cloudPreview?: string }) => void
  trendRows: Array<{ result: LabResult; docId: string; docDate: string | null }>
}) {
  const [chunks, setChunks] = useState<Chunk[]>([])
  const [indexReady, setIndexReady] = useState(false)
  const [indexError, setIndexError] = useState<string | null>(null)
  // Indexing starts immediately on mount (the effect kicks it off).
  const [indexing, setIndexing] = useState(true)

  const build = useCallback(async () => {
    try {
      const docChunks = chunkLines({ docId, lines: approvedText.split('\n') })
      await buildIndex(docChunks, getEmbedder())
      setChunks(docChunks)
      setIndexError(null)
      setIndexReady(true)
    } catch (err) {
      setChunks([])
      setIndexError(
        err instanceof Error ? err.message : 'On-device indexing unavailable.',
      )
    } finally {
      setIndexing(false)
    }
  }, [docId, approvedText])

  useEffect(() => {
    queueMicrotask(() => void build())
  }, [build])

  const docChunks = chunks.length > 0
    ? chunks
    : chunkLines({ docId, lines: approvedText.split('\n') })
  const labRows = labResults.map((result) => ({ result, docId, docDate }))

  if (indexing) {
    return <p role="status" className="intel-panel">Indexing on-device…</p>
  }

  if (indexError !== null || !indexReady) {
    return (
      <>
        {indexError !== null && (
          <p role="status" className="intel-panel">
            On-device search is unavailable ({indexError}). The embedding model
            downloads once; try again while online.
          </p>
        )}
        <IntelligencePanel
          docId={docId}
          chunks={docChunks}
          ask={async () => {
            throw new Error(
              'the on-device index is unavailable — answers are disabled until the model is cached',
            )
          }}
          labRows={labRows}
        />
      </>
    )
  }

  return (
    <>
      <IntelligencePanel
        docId={docId}
        chunks={docChunks}
        ask={ask}
        onRan={onRan}
        labRows={labRows}
      />
      <TrendsPanel labRows={trendRows} />
    </>
  )
}

export default App
