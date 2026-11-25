import { useEffect, useState } from 'react'
import { NANO_UNAVAILABLE_MESSAGE, type ScanItem, type ScanQueue } from './scanQueue'
import type { OcrRow } from './extract'

/**
 * Photo scanning UI (feature 08): progress card for the background queue
 * plus the "confirm extracted values" step that feeds the redaction
 * review. Files enter the queue from the App's file input. Flow helpers
 * live in ./scanFlow.ts.
 */

export interface ScanPanelProps {
  queue: ScanQueue
  onConfirm: (rows: OcrRow[], label: string) => void
  onCancel: () => void
  pendingLabel: string
}

export function ScanPanel({ queue, onConfirm, onCancel, pendingLabel }: ScanPanelProps) {
  const [items, setItems] = useState<ScanItem[]>([])
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [edits, setEdits] = useState<Map<number, string>>(new Map())

  useEffect(() => queue.subscribe(setItems), [queue])

  const done = items.filter((item) => item.status === 'done')
  const failed = items.filter((item) => item.status === 'failed')
  const working = items.some(
    (item) => item.status === 'queued' || item.status === 'processing',
  )
  const rows = queue.doneRows()

  function toggle(rowIndex: number): void {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(rowIndex)) next.delete(rowIndex)
      else next.add(rowIndex)
      return next
    })
  }

  function confirmRows(): void {
    const kept = rows.filter((_, i) => !checked.has(i))
    // Apply user edits for confirmed rows (wrong numbers are NEVER
    // auto-corrected — the user must type the fix).
    const fixed = kept.map((row, i) => {
      const edit = edits.get(i)
      if (edit === undefined || edit.trim() === '') return row
      const value = Number.parseFloat(edit.trim().replace(/,/g, ''))
      return { ...row, value: Number.isNaN(value) ? row.value : value }
    })
    onConfirm(fixed, pendingLabel)
  }

  return (
    <section aria-labelledby="scan-heading" className="intel-panel">
      <h3 id="scan-heading">Photo scan (on-device)</h3>
      {working ? (
        <p role="status">
          Reading {items.length} photo{items.length === 1 ? '' : 's'} on-device…
        </p>
      ) : (
        <p role="status">
          {done.length > 0
            ? `${rows.length} value rows read from ${done.length} photo${done.length === 1 ? '' : 's'}.`
            : 'No photos processed yet.'}
        </p>
      )}
      {failed.length > 0 && (
        <p role="alert">
          {failed.length} photo{failed.length === 1 ? '' : 's'} failed:{' '}
          {failed[0].error === NANO_UNAVAILABLE_MESSAGE
            ? 'Photo scanning needs on-device AI in Chrome; please upload a text PDF.'
            : failed[0].error}
        </p>
      )}

      <ul className="scan-list">
        {items.map((item) => (
          <li key={item.id}>
            {item.name} —{' '}
            {item.status === 'done'
              ? `read ${item.rows?.length ?? 0} rows`
              : item.status === 'failed'
                ? 'failed'
                : item.status}
          </li>
        ))}
      </ul>

      {!working && done.length > 0 && (
        <div className="confirm-values">
          <h4>Confirm extracted values</h4>
          <p className="review-hint">
            Untick anything wrong, fix values inline if needed — wrong numbers
            are never auto-corrected.
          </p>
          <table>
            <thead>
              <tr>
                <th scope="col">Keep</th>
                <th scope="col">Test</th>
                <th scope="col">Value</th>
                <th scope="col">Units</th>
                <th scope="col">Flag</th>
                <th scope="col">Range</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Keep ${row.label}`}
                      checked={!checked.has(i)}
                      onChange={() => toggle(i)}
                    />
                  </td>
                  <td>{row.label}</td>
                  <td>
                    <input
                      type="text"
                      inputMode="decimal"
                      aria-label={`Value for ${row.label}`}
                      value={edits.get(i) ?? (row.value === null ? '' : String(row.value))}
                      onChange={(e) =>
                        setEdits((prev) => new Map(prev).set(i, e.target.value))
                      }
                      className="confirm-input"
                    />
                  </td>
                  <td>{row.unit ?? ''}</td>
                  <td>{row.flag ?? ''}</td>
                  <td>{row.refText ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            <button type="button" className="approve" onClick={confirmRows}>
              Confirm and continue to redaction
            </button>
            <button type="button" onClick={onCancel}>
              Discard scan
            </button>
          </p>
        </div>
      )}
    </section>
  )
}
