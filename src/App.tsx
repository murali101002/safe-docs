import { useState } from 'react'
import './App.css'
import { AuthScreen } from './auth/AuthScreen'
import { useAuth } from './auth/useAuth'
import { StatusBanner } from './components/StatusBanner'
import { extractTextItems, groupRows, type PdfRow } from './pdf/extract'
import { parseDocDate, parseLabResults, type LabResult } from './labs/parseRows'
import { LabResultsTable } from './labs/LabResultsTable'
import { generateOnDevice } from './ai/hybrid'

function App() {
  const { user, loading, signOut } = useAuth()
  const [rows, setRows] = useState<PdfRow[]>([])
  const [results, setResults] = useState<LabResult[]>([])
  const [docDate, setDocDate] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [answer, setAnswer] = useState<string | null>(null)

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
    try {
      const items = await extractTextItems(await file.arrayBuffer())
      const grouped = groupRows(items)
      setRows(grouped)
      setResults(parseLabResults(grouped))
      setDocDate(parseDocDate(grouped))
      setFileName(file.name)
      setAnswer(null)
    } catch (err) {
      setRows([])
      setResults([])
      setDocDate(null)
      setFileName(null)
      setError(err instanceof Error ? err.message : 'Failed to read PDF')
    }
  }

  async function onExplain() {
    setError(null)
    setAnswer(null)
    try {
      const prompt =
        `You help patients understand their medical record. ` +
        `Explain the following document extract in plain language. ` +
        `Document "${fileName ?? 'record.pdf'}":\n` +
        rows.map((row) => row.map((cell) => cell.text).join(' | ')).join('\n')
      // Raw rows may contain PII, so this runs on-device ONLY — it must
      // never fall back to the cloud (redaction arrives in feature 04).
      const { text } = await generateOnDevice(prompt)
      setAnswer(text)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI request failed')
    }
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

        {fileName && (
          <p>
            <strong>{fileName}</strong>
            {docDate && <> — collected {docDate}</>} — {results.length} lab
            values parsed
            <button type="button" onClick={onExplain}>
              Explain this document (on-device)
            </button>
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        {answer && <pre className="answer">{answer}</pre>}

        {fileName && <LabResultsTable results={results} />}
      </main>
    </>
  )
}

export default App
