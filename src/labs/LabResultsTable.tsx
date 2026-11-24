import type { LabResult } from './parseRows'

const FLAG_LABELS: Record<NonNullable<LabResult['flag']>, string> = {
  H: 'High',
  L: 'Low',
  N: 'Normal',
}

/**
 * Parsed lab results table with H/L highlighting.
 *
 * Flag colors: H = red (above range), L = amber (below range), N = neutral.
 * The flag cell carries an aria-label with the full word so screen readers
 * announce "High"/"Low", not just a letter.
 */
export function LabResultsTable({ results }: { results: LabResult[] }) {
  if (results.length === 0) {
    return (
      <p role="status" className="lab-empty">
        No lab values were recognized in this document yet.
      </p>
    )
  }

  return (
    <div className="lab-table-wrap">
      <table className="lab-table">
        <caption>
          Parsed lab results ({results.length})
          {' '}— informational only, not medical advice.
        </caption>
        <thead>
          <tr>
            <th scope="col">Test</th>
            <th scope="col">Result</th>
            <th scope="col">Flag</th>
            <th scope="col">Units</th>
            <th scope="col">Reference range</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r, i) => (
            <tr key={i} className={r.flag ? `flag-row-${r.flag}` : undefined}>
              <th scope="row">{r.test}</th>
              <td>{r.value ?? '—'}</td>
              <td aria-label={r.flag ? FLAG_LABELS[r.flag] : undefined}>
                {r.flag ? (
                  <span className={`flag-badge flag-${r.flag}`}>
                    {r.flag}
                    <span aria-hidden="true"> {FLAG_LABELS[r.flag]}</span>
                  </span>
                ) : (
                  '—'
                )}
              </td>
              <td>{r.unit ?? '—'}</td>
              <td>{r.refText ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="lab-disclaimer">
        Flagged values are automatically compared against the printed
        reference range. This is informational only and not medical advice —
        discuss your results with your clinician.
      </p>
    </div>
  )
}
