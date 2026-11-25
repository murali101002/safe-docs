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
import { chunkLines, type Chunk } from './retrieval/chunk'
import { createEmbedder, type Embedder } from './retrieval/embedder'
import { buildIndex, type BuildResult } from './retrieval/indexer'
import { IntelligencePanel } from './intelligence/IntelligencePanel'

/**
 * The transformers.js worker spawns on first use; keep one instance for the
 * whole session (module-level, not per render).
 */
let sessionEmbedder: Embedder | null = null
function getEmbedder(): Embedder {
  sessionEmbedder ??= createEmbedder()
  return sessionEmbedder
}

function App() {
  const { user, loading, signOut } = useAuth()
  const [results, setResults] = useState<LabResult[]>([])
  const [docDate, setDocDate] = useState<string | null>(null)
  const [docId, setDocId] = useState<string | null>(null)
  const [docText, setDocText] = useState<string | null>(null)
  const [spans, setSpans] = useState<RedactionSpan[]>([])
  const [removedIds, setRemovedIds] = useState<ReadonlySet<string>>(new Set())
  const [customSpans, setCustomSpans] = useState<RedactionSpan[]>([])
  const [approved, setApproved] = useState<ApprovedRedaction | null>(null)
  const [nanoNote, setNanoNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [parsing, setParsing] = useState(false)

  // Wait for the initial auth state before deciding what to render,
  // so a signed-in user never sees the auth screen flash.
  if (loading) {
    return (
      <main>
        <h1>SafeDocs</h1>
        <p role="status">Checking sign-in…</p>
      </main>
    )
  }

  if (!user) {
    return <AuthScreen />
  }

  async function onFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
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
      setRemovedIds(new Set())
      setCustomSpans([])

      // Layer 2 (names/addresses) needs Chrome's on-device model.
      let useNano = false
      try {
        useNano = await isOnDeviceAvailable()
      } catch {
        useNano = false
      }
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

  async function onApprove() {
    if (docText === null || docId === null) return
    const all = [...spans, ...customSpans]
    const approvedRedaction = approveRedactions(
      docText,
      docId,
      all,
      new Set(all.map((s) => s.id).filter((id) => !removedIds.has(id))),
    )
    // Token map stays on this device (IndexedDB). Nothing is synced.
    await saveTokenMap(docId, approvedRedaction.tokenMap)
    setApproved(approvedRedaction)
  }

  return (
    <>
      <StatusBanner inference="device" />
      <main>
        <h1>SafeDocs</h1>
        <p>
          Privacy-first: your PDF is parsed locally, and anything that may
          contain personal information runs only on Chrome&apos;s on-device
          model. Nothing leaves this computer.
        </p>
        <p>
          Signed in.{' '}
          <button type="button" onClick={() => void signOut()}>
            Sign out
          </button>
        </p>
        <label>
          <p>Choose a medical record PDF:</p>
          <input type="file" accept="application/pdf" onChange={onFileChange} />
        </label>

        {parsing && <p role="status">Reading document locally…</p>}
        {error && <p role="alert">{error}</p>}

        {docId && !parsing && (
          <>
            <p>
              <strong>{docId.split('::')[0]}</strong>
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
                    The token map is stored only on this device. Nothing has
                    been sent anywhere — cloud features (coming next) can only
                    use the redacted text below.
                  </p>
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
    </>
  )
}

/**
 * Builds the on-device retrieval index over the approved REDACTED text
 * (vectors live in IndexedDB on this device) and renders the search panel.
 */
function RetrievalSection({
  docId,
  docDate,
  labResults,
  approvedText,
}: {
  docId: string
  docDate: string | null
  labResults: LabResult[]
  approvedText: string
}) {
  const [chunks, setChunks] = useState<Chunk[]>([])
  const [index, setIndex] = useState<BuildResult | null>(null)
  const [indexError, setIndexError] = useState<string | null>(null)
  // Indexing starts immediately on mount (the effect kicks it off).
  const [indexing, setIndexing] = useState(true)

  const build = useCallback(async () => {
    try {
      const docChunks = chunkLines({ docId, lines: approvedText.split('\n') })
      const result = await buildIndex(docChunks, getEmbedder())
      setChunks(docChunks)
      setIndex(result)
      setIndexError(null)
    } catch (err) {
      setChunks([])
      setIndex(null)
      setIndexError(
        err instanceof Error ? err.message : 'On-device indexing unavailable.',
      )
    } finally {
      setIndexing(false)
    }
  }, [docId, approvedText])

  useEffect(() => {
    // Kick the build off after the render commits (queueMicrotask keeps the
    // setState calls out of the synchronous effect body).
    queueMicrotask(() => void build())
  }, [build])

  if (indexing) {
    return <p role="status" className="search-panel">Indexing on-device…</p>
  }
  if (indexError !== null) {
    return (
      <p role="status" className="search-panel">
        On-device search is unavailable ({indexError}). The embedding model
        downloads once; try again while online.
      </p>
    )
  }
  if (index === null || chunks.length === 0) {
    return null
  }

  const labRows = labResults.map((result) => ({ result, docId, docDate }))

  return (
    <IntelligencePanel
      docId={docId}
      docDate={docDate}
      chunks={chunks}
      index={index}
      embedder={getEmbedder()}
      labRows={labRows}
    />
  )
}

export default App
