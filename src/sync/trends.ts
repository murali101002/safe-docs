import type { LabResult } from '../labs/parseRows'

/**
 * Trend data helpers (feature 07): grouping structured lab rows across
 * approved documents. Pure functions, tested in src/sync/trends.test.ts.
 */

export interface TrendRow {
  result: LabResult
  docId: string
  docDate: string | null
}

export type TestGroup = Array<TrendRow & { sortDate: string }>

/** Group rows by test name (case/whitespace-insensitive), dated rows only. */
export function groupByTest(rows: TrendRow[]): Map<string, TestGroup> {
  const groups = new Map<string, TestGroup>()
  for (const row of rows) {
    if (row.docDate === null || row.result.value === null) continue
    const key = row.result.test.trim().toLowerCase()
    const list = groups.get(key) ?? []
    list.push({ ...row, sortDate: row.docDate })
    groups.set(key, list)
  }
  for (const list of groups.values()) {
    list.sort((a, b) => a.sortDate.localeCompare(b.sortDate))
  }
  return groups
}

/** Tests that have at least two dated results (chartable). */
export function chartableTests(rows: TrendRow[]): Array<{ key: string; label: string }> {
  const out: Array<{ key: string; label: string }> = []
  for (const [key, list] of groupByTest(rows)) {
    if (list.length >= 2) {
      out.push({ key, label: list[0].result.test })
    }
  }
  return out
}
