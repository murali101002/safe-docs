import { useMemo, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { chartableTests, groupByTest, type TrendRow } from './trends'
import type { LabResult } from '../labs/parseRows'

/**
 * Lab trend chart across collection dates (feature 07). All data is the
 * structured lab rows of locally-registered approved documents. Data
 * helpers live in ./trends.ts (tested separately).
 */

export function TrendsPanel({ labRows }: { labRows: TrendRow[] }) {
  const groups = useMemo(() => groupByTest(labRows), [labRows])
  const chartable = useMemo(() => chartableTests(labRows), [labRows])
  const [selected, setSelected] = useState<string | null>(null)

  const activeKey = selected ?? chartable[0]?.key ?? null
  const series = activeKey !== null ? (groups.get(activeKey) ?? []) : []
  const latest = series.at(-1)
  const unit = latest?.result.unit ?? ''

  return (
    <section aria-labelledby="trends-heading" className="intel-panel">
      <h3 id="trends-heading">Trends across documents</h3>
      {chartable.length === 0 ? (
        <p role="status">
          Approve at least two documents with collection dates to see trends.
        </p>
      ) : (
        <>
          <label className="trend-picker">
            <span>Test: </span>
            <select
              aria-label="Choose a test to chart"
              value={activeKey ?? ''}
              onChange={(e) => setSelected(e.target.value)}
            >
              {chartable.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <div className="trend-chart" role="img" aria-label={`Trend chart for ${series[0]?.result.test ?? 'test'}`}>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={series} margin={{ top: 12, right: 16, bottom: 8, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="sortDate" />
                <YAxis
                  label={{ value: unit, angle: -90, position: 'insideLeft', fontSize: 12 }}
                />
                <Tooltip
                  formatter={(value) => [`${String(value)} ${unit}`, latest?.result.test ?? '']}
                  labelFormatter={(label) => `Collected ${String(label)}`}
                />
                {latest?.result.refLow !== null && latest?.result.refLow !== undefined && (
                  <ReferenceLine
                    y={latest.result.refLow}
                    stroke="#0a7d33"
                    strokeDasharray="4 4"
                    label={{ value: 'low', position: 'insideBottomLeft', fontSize: 11 }}
                  />
                )}
                {latest?.result.refHigh !== null && latest?.result.refHigh !== undefined && (
                  <ReferenceLine
                    y={latest.result.refHigh}
                    stroke="#b3261e"
                    strokeDasharray="4 4"
                    label={{ value: 'high', position: 'insideTopLeft', fontSize: 11 }}
                  />
                )}
                <Line
                  type="monotone"
                  dataKey={(row: { result: LabResult }) => row.result.value}
                  data={series}
                  name={latest?.result.test ?? ''}
                  stroke="#0b57d0"
                  strokeWidth={2}
                  dot={{ r: 4 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="review-hint">
            Dashed lines mark the most recent reference range. Informational
            only — not medical advice.
          </p>
        </>
      )}
    </section>
  )
}
