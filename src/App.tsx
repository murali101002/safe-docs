import { useState } from 'react'
import './App.css'
import { AuthScreen } from './auth/AuthScreen'
import { useAuth } from './auth/useAuth'
import { StatusBanner } from './components/StatusBanner'
import { extractTextItems, groupRows, type PdfRow } from './pdf/extract'
import { generate } from './ai/hybrid'

function App() {
  const { user, loading, signOut } = useAuth()
  const [rows, setRows] = useState<PdfRow[]>([])
  const [fileName, setFileName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [answer, setAnswer] = useState<string | null>(null)
  const [inference, setInference] = useState<'device' | 'cloud' | undefined>(
    undefined,
  )

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
      setRows(groupRows(items))
      setFileName(file.name)
    } catch (err) {
      setRows([])
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
      const result = await generate(prompt)
      setAnswer(result.text)
      setInference(result.ranOn)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI request failed')
    }
  }

  return (
    <>
      <StatusBanner inference={inference} />
      <main>
        <h1>SafeDocs</h1>
        <p>
          Privacy-first: your PDF is parsed locally. Ask a question and the
          answer prefers Chrome&apos;s on-device model; nothing is uploaded
          unless cloud inference is required.
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
            <strong>{fileName}</strong> — {rows.length} rows extracted
            <button type="button" onClick={onExplain}>
              Explain this document
            </button>
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        {answer && <pre className="answer">{answer}</pre>}

        {rows.length > 0 && (
          <table>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j}>{cell.text}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </main>
    </>
  )
}

export default App
