import { useRef, useState, type ReactNode } from 'react'
import type { RedactionSpan, RedactionType } from './types'

const TYPE_LABELS: Record<RedactionType, string> = {
  SSN: 'Social Security number',
  PHONE: 'Phone number',
  EMAIL: 'Email address',
  DOB: 'Date of birth',
  MRN: 'Medical record number',
  INSURANCE: 'Insurance / member ID',
  ADDRESS: 'Street address',
  ZIP: 'ZIP code',
  NAME: 'Person name',
  CUSTOM: 'Custom redaction',
}

/** Render the document with redaction highlights and handle selection. */
export function RedactionReview({
  text,
  spans,
  removedIds,
  onToggle,
  onAddCustom,
  onApprove,
}: {
  text: string
  spans: RedactionSpan[]
  removedIds: ReadonlySet<string>
  onToggle: (spanId: string) => void
  onAddCustom: (start: number, end: number) => void
  onApprove: () => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [selectionNote, setSelectionNote] = useState<string | null>(null)

  const kept = spans.filter((s) => !removedIds.has(s.id))

  /** Map a DOM selection inside the container back to plain-text offsets. */
  function selectionOffsets(): { start: number; end: number } | null {
    const container = containerRef.current
    if (container === null) return null
    const selection = window.getSelection()
    if (selection === null || selection.rangeCount === 0) return null
    const range = selection.getRangeAt(0)
    if (!container.contains(range.commonAncestorContainer)) return null

    let start = -1
    let end = -1
    let seen = 0
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    while (node !== null) {
      const len = node.textContent?.length ?? 0
      if (node === range.startContainer) start = seen + range.startOffset
      if (node === range.endContainer) end = seen + range.endOffset
      seen += len
      node = walker.nextNode()
    }
    if (start === -1 || end === -1 || end <= start) return null
    return { start, end }
  }

  function onMouseUp() {
    const offsets = selectionOffsets()
    if (offsets === null) {
      setSelectionNote(null)
      return
    }
    const selected = text.slice(offsets.start, offsets.end).trim()
    if (selected === '') {
      setSelectionNote(null)
      return
    }
    setSelectionNote(
      `Selected: "${selected.length > 40 ? selected.slice(0, 40) + '…' : selected}"`,
    )
  }

  function addFromSelection() {
    const offsets = selectionOffsets()
    if (offsets === null) {
      setSelectionNote('Select text in the document first.')
      return
    }
    // Expand to trimmed bounds so the token has no stray whitespace.
    const raw = text.slice(offsets.start, offsets.end)
    const lead = raw.length - raw.trimStart().length
    const start = offsets.start + lead
    const end = start + raw.trim().length
    if (end <= start) {
      setSelectionNote('Select text in the document first.')
      return
    }
    onAddCustom(start, end)
    setSelectionNote('Custom redaction added — review it below.')
    window.getSelection()?.removeAllRanges()
  }

  return (
    <section aria-labelledby="redaction-heading" className="redaction-review">
      <h3 id="redaction-heading">Review redactions before anything is shared</h3>
      <p role="status">
        {kept.length} redaction{kept.length === 1 ? '' : 's'} will be applied.
        Nothing has been sent anywhere yet — approving only stores the token
        map on this device.
      </p>
      <p className="review-hint">
        Click a highlight to remove it, select text to add a redaction, then
        approve.
      </p>

      <div
        ref={containerRef}
        onMouseUp={onMouseUp}
        className="redaction-text"
        aria-label="Document text with proposed redactions"
      >
        {renderSegments(text, spans, removedIds, onToggle)}
      </div>

      {selectionNote && (
        <p role="status" className="selection-note">
          {selectionNote}
        </p>
      )}
      <p>
        <button type="button" onClick={addFromSelection}>
          Redact selected text
        </button>
        <button type="button" onClick={onApprove} className="approve">
          Approve redactions
        </button>
      </p>
    </section>
  )
}

/** Render text with <mark> highlights for every span. */
function renderSegments(
  text: string,
  spans: RedactionSpan[],
  removedIds: ReadonlySet<string>,
  onToggle: (spanId: string) => void,
): ReactNode[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start)
  const nodes: ReactNode[] = []
  let cursor = 0
  sorted.forEach((span, i) => {
    if (span.start > cursor) nodes.push(text.slice(cursor, span.start))
    const removed = removedIds.has(span.id)
    nodes.push(
      <mark
        key={`${span.id}-${i}`}
        data-span-id={span.id}
        className={removed ? 'redaction-removed' : 'redaction-active'}
        title={`${TYPE_LABELS[span.type]}${removed ? ' (removed)' : ''} — click to ${removed ? 'restore' : 'remove'}`}
        onClick={() => onToggle(span.id)}
      >
        {text.slice(span.start, span.end)}
      </mark>,
    )
    cursor = span.end
  })
  if (cursor < text.length) nodes.push(text.slice(cursor))
  return nodes
}
