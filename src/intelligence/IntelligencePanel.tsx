import { useCallback, useState } from 'react'
import type { AskOutcome } from '../ai/hybridAsk'
import type { Chunk } from '../retrieval/chunk'
import { ANSWER_DISCLAIMER, docLabelOf } from './qa'
import { explainLabValue } from './explain'
import { questionsForDoctor } from './doctorQuestions'
import { summarizeDocument, type SummaryProgress } from './summary'
import type { LabResult } from '../labs/parseRows'

/**
 * On-device intelligence panel (feature 06/07): Q&A (routed by the hybrid
 * router via the injected `ask` callback), document summary (map-reduce
 * with progress), per-value explanations, and "questions for my doctor" —
 * the local features run through the on-device model, so they work in
 * airplane mode.
 */

export interface IntelligencePanelProps {
  docId: string
  /** Approved redacted chunks of the current document (for summaries). */
  chunks: Chunk[]
  /** Ask through the hybrid router; returns the answer + routing metadata. */
  ask: (question: string) => Promise<AskOutcome>
  /** Notify the app of the last answer's target/reason (for the banner). */
  onRan?: (info: { target: 'device' | 'cloud'; reason: string; cloudPreview?: string }) => void
  labRows: Array<{ result: LabResult; docId: string; docDate: string | null }>
}

interface AnswerState extends AskOutcome {
  question: string
}

export function IntelligencePanel({
  docId,
  chunks,
  ask,
  onRan,
  labRows,
}: IntelligencePanelProps) {
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState<AnswerState | null>(null)
  const [asking, setAsking] = useState(false)
  const [askError, setAskError] = useState<string | null>(null)

  const [summary, setSummary] = useState<string | null>(null)
  const [summaryProgress, setSummaryProgress] = useState<SummaryProgress | null>(null)
  const [summaryError, setSummaryError] = useState<string | null>(null)

  const [explanation, setExplanation] = useState<{ test: string; text: string } | null>(null)
  const [explaining, setExplaining] = useState<string | null>(null)
  const [explainError, setExplainError] = useState<string | null>(null)

  const [doctor, setDoctor] = useState<string[] | null>(null)
  const [doctorBusy, setDoctorBusy] = useState(false)
  const [doctorError, setDoctorError] = useState<string | null>(null)
  const [doctorDiscarded, setDoctorDiscarded] = useState(0)

  const flagged = labRows.filter((r) => r.result.flag === 'H' || r.result.flag === 'L')

  const onAsk = useCallback(async () => {
    const q = question.trim()
    if (q === '' || asking) return
    setAsking(true)
    setAskError(null)
    try {
      const outcome = await ask(q)
      setAnswer({ ...outcome, question: q })
      onRan?.({ target: outcome.target, reason: outcome.reason, cloudPreview: outcome.cloudPreview })
    } catch (err) {
      setAskError(err instanceof Error ? err.message : 'Answering failed')
      setAnswer(null)
    } finally {
      setAsking(false)
    }
  }, [question, asking, ask, onRan])

  const onSummarize = useCallback(async () => {
    if (summaryProgress !== null) return
    setSummary(null)
    setSummaryError(null)
    setSummaryProgress({ done: 0, total: chunks.length })
    try {
      const { summary: text } = await summarizeDocument(
        { chunks, docId },
        { onProgress: (p) => setSummaryProgress({ ...p }) },
      )
      setSummary(text)
    } catch (err) {
      setSummaryError(err instanceof Error ? err.message : 'Summarizing failed')
    } finally {
      setSummaryProgress(null)
    }
  }, [chunks, docId, summaryProgress])

  const onExplain = useCallback(
    async (row: { result: LabResult; docId: string; docDate: string | null }) => {
      setExplaining(row.result.test)
      setExplainError(null)
      try {
        const { text } = await explainLabValue({
          result: row.result,
          docId: row.docId,
          docDate: row.docDate,
        })
        setExplanation({ test: row.result.test, text })
      } catch (err) {
        setExplainError(err instanceof Error ? err.message : 'Explaining failed')
        setExplanation(null)
      } finally {
        setExplaining(null)
      }
    },
    [],
  )

  const onDoctorQuestions = useCallback(async () => {
    setDoctorBusy(true)
    setDoctorError(null)
    setDoctor(null)
    try {
      const { questions, discarded } = await questionsForDoctor({ flagged: flagged.map((f) => f.result), docId })
      setDoctor(questions)
      setDoctorDiscarded(discarded)
    } catch (err) {
      setDoctorError(err instanceof Error ? err.message : 'Could not generate questions')
    } finally {
      setDoctorBusy(false)
    }
  }, [flagged, docId])

  return (
    <section aria-labelledby="intel-heading" className="intel-panel">
      <h3 id="intel-heading">Understand this document (on-device)</h3>
      <p className="review-hint">
        Every answer here runs on Chrome&apos;s on-device model — this panel
        works in airplane mode and nothing leaves this computer.
      </p>

      {/* Q&A with citations */}
      <form
        className="ask-form"
        onSubmit={(e) => {
          e.preventDefault()
          void onAsk()
        }}
      >
        <input
          type="search"
          aria-label="Ask a question about this document"
          placeholder="Ask about this document, e.g. What was my A1C?"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <button type="submit" disabled={asking || chunks.length === 0}>
          {asking ? 'Thinking…' : 'Ask'}
        </button>
      </form>
      {askError && <p role="alert">{askError}</p>}
      {answer && (
        <div className="answer-box" role="status">
          {answer.target === 'cloud' ? (
            <p className="ran-badge cloud-badge">
              🔵 Ran in cloud: {answer.reason}
            </p>
          ) : (
            <p className="ran-badge">
              🟢 Ran on-device: {answer.reason}
            </p>
          )}
          {answer.limited && (
            <p className="answer-problem">
              Limited mode: only the documents on this device are available.
            </p>
          )}
          {answer.lowConfidence && (
            <p className="answer-problem">
              Low retrieval confidence — the document may not contain a clear
              answer to this question.
            </p>
          )}
          {answer.problem && (
            <p className="answer-problem">
              Note: this answer {answer.problem === 'no citation' ? 'has no source citations' : 'came back empty'} —
              treat it with extra care.
            </p>
          )}
          <pre className="answer-text">{answer.text}</pre>
          <p className="answer-disclaimer">{ANSWER_DISCLAIMER}</p>
          {answer.labHits.length > 0 && (
            <details>
              <summary>Matching lab values ({answer.labHits.length})</summary>
              <ul className="lab-hits">
                {answer.labHits.map((hit, i) => (
                  <li key={i}>
                    {hit.result.test}: <strong>{hit.result.value ?? '—'}</strong>{' '}
                    {hit.result.unit ?? ''}{' '}
                    {hit.result.flag ? `(flag ${hit.result.flag})` : ''} —{' '}
                    {docLabelOf(hit.docId)}
                    {hit.docDate ? `, collected ${hit.docDate}` : ''}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {answer.sources.length > 0 && (
            <details>
              <summary>Sources used ({answer.sources.length})</summary>
              <ul className="chunk-hits">
                {answer.sources.map((hit) => (
                  <li key={hit.chunk.id}>
                    <strong>
                      {docLabelOf(hit.chunk.docId)}, page {hit.chunk.pages.join(', ')}
                    </strong>{' '}
                    <span className="review-hint">(score {hit.score.toFixed(3)})</span>
                    <pre className="chunk-preview">{hit.chunk.text}</pre>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {/* Map-reduce summary with progress bar */}
      <div className="intel-row">
        <button type="button" onClick={() => void onSummarize()} disabled={summaryProgress !== null}>
          Summarize document
        </button>
        {summaryProgress && (
          <p role="status" className="progress-line">
            <progress
              value={summaryProgress.done}
              max={summaryProgress.total}
              aria-label="Summary progress"
            />{' '}
            Summarizing section {summaryProgress.done} of {summaryProgress.total}…
          </p>
        )}
        {summaryError && <p role="alert">{summaryError}</p>}
        {summary && (
          <div className="answer-box" role="status">
            <p className="ran-badge">🟢 Ran on-device: nothing left this computer</p>
            <pre className="answer-text">{summary}</pre>
            <p className="answer-disclaimer">{ANSWER_DISCLAIMER}</p>
          </div>
        )}
      </div>

      {/* Flagged values + explanations */}
      <div className="intel-row">
        <h4>Flagged values</h4>
        {flagged.length === 0 ? (
          <p role="status">No out-of-range values were found in this document.</p>
        ) : (
          <ul className="flagged-list">
            {flagged.map((row) => (
              <li key={`${row.result.test}-${row.result.page}`}>
                {row.result.test} — {row.result.value ?? '—'} {row.result.unit ?? ''}{' '}
                (flag {row.result.flag})
                <button
                  type="button"
                  onClick={() => void onExplain(row)}
                  disabled={explaining !== null}
                >
                  {explaining === row.result.test ? 'Explaining…' : 'Explain'}
                </button>
              </li>
            ))}
          </ul>
        )}
        {explainError && <p role="alert">{explainError}</p>}
        {explanation && (
          <div className="answer-box" role="status">
            <p className="ran-badge">🟢 Ran on-device: nothing left this computer</p>
            <h5>{explanation.test}</h5>
            <pre className="answer-text">{explanation.text}</pre>
            <p className="answer-disclaimer">{ANSWER_DISCLAIMER}</p>
          </div>
        )}
      </div>

      {/* Questions for my doctor */}
      <div className="intel-row">
        <button
          type="button"
          onClick={() => void onDoctorQuestions()}
          disabled={doctorBusy || flagged.length === 0}
        >
          {doctorBusy ? 'Preparing…' : 'Questions for my doctor'}
        </button>
        {doctorError && <p role="alert">{doctorError}</p>}
        {doctor && (
          <div className="answer-box" role="status">
            <p className="ran-badge">🟢 Ran on-device: nothing left this computer</p>
            {doctor.length === 0 ? (
              <p>No usable questions came back — try again.</p>
            ) : (
              <ol className="doctor-questions">
                {doctor.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ol>
            )}
            {doctorDiscarded > 0 && (
              <p className="review-hint">{doctorDiscarded} unusable suggestion(s) were discarded.</p>
            )}
            <p className="answer-disclaimer">{ANSWER_DISCLAIMER}</p>
          </div>
        )}
      </div>
    </section>
  )
}
