import { useCallback, useRef, useState } from 'react'
import type { Chunk } from './chunk'
import type { Embedder } from './embedder'
import { embedQuery } from './indexer'
import { matchLabRows, rankChunks } from './search'
import type { LabHit, RetrievedChunk } from './search'
import type { LabResult } from '../labs/parseRows'

/**
 * Minimal search panel over the on-device index (feature 05).
 * Feature 06 replaces this with full on-device Q&A; the ranking functions
 * are shared.
 */
export function SearchPanel({
  docId,
  chunks,
  vectors,
  embedder,
  labRows,
}: {
  docId: string
  chunks: Chunk[]
  vectors: Map<string, Float32Array>
  embedder: Embedder
  labRows: Array<{ result: LabResult; docId: string; docDate: string | null }>
}) {
  const [query, setQuery] = useState('')
  const [chunkHits, setChunkHits] = useState<RetrievedChunk[] | null>(null)
  const [labHits, setLabHits] = useState<LabHit[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)

  const onSearch = useCallback(async () => {
    const q = query.trim()
    if (q === '' || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      const queryVector = await embedQuery(q, embedder)
      setChunkHits(rankChunks(q, chunks, vectors, queryVector, 3))
      setLabHits(matchLabRows(q, labRows, 5))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed')
      setChunkHits(null)
      setLabHits(null)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }, [query, chunks, vectors, embedder, labRows])

  return (
    <section aria-labelledby="search-heading" className="search-panel">
      <h3 id="search-heading">Search this document (on-device)</h3>
      <p className="review-hint">
        Runs entirely on this computer: embeddings + keyword ranking over the
        approved redacted text.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void onSearch()
        }}
      >
        <input
          type="search"
          aria-label="Search the document"
          placeholder="e.g. What was my A1C?"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="submit" disabled={busy || chunks.length === 0}>
          {busy ? 'Searching…' : 'Search'}
        </button>
      </form>
      {error && <p role="alert">{error}</p>}

      {labHits !== null && (
        <div>
          <h4>Matching lab values</h4>
          {labHits.length === 0 ? (
            <p role="status">No lab rows match that query.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th scope="col">Test</th>
                  <th scope="col">Result</th>
                  <th scope="col">Flag</th>
                  <th scope="col">Date</th>
                </tr>
              </thead>
              <tbody>
                {labHits.map((hit, i) => (
                  <tr key={i}>
                    <th scope="row">{hit.result.test}</th>
                    <td>{hit.result.value ?? '—'} {hit.result.unit ?? ''}</td>
                    <td>{hit.result.flag ?? '—'}</td>
                    <td>{hit.docDate ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {chunkHits !== null && (
        <div>
          <h4>Matching sections</h4>
          {chunkHits.length === 0 ? (
            <p role="status">No sections matched that query.</p>
          ) : (
            <ul className="chunk-hits">
              {chunkHits.map((hit) => (
                <li key={hit.chunk.id}>
                  <strong>
                    {docId.split('::')[0]}, page {hit.chunk.pages.join(', ')}
                  </strong>{' '}
                  <span className="review-hint">
                    (score {hit.score.toFixed(3)})
                  </span>
                  <pre className="chunk-preview">{hit.chunk.text}</pre>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
