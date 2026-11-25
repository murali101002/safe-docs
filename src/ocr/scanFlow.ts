import { createScanQueue, NANO_UNAVAILABLE_MESSAGE, type ScanQueue } from './scanQueue'
import type { OcrRow } from './extract'

/**
 * Scan flow helpers (feature 08) — kept out of ScanPanel.tsx so the
 * component file stays component-only.
 */

export { NANO_UNAVAILABLE_MESSAGE }
export type { ScanQueue, OcrRow }

/** Create the app scan queue wired to the browser Notification API. */
export function createAppScanQueue(): ScanQueue {
  return createScanQueue({
    notify: (title, body) => {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification(title, { body })
      }
    },
  })
}

/** Ask for notification permission as part of a user gesture. */
export async function requestScanPermissions(): Promise<void> {
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
    try {
      await Notification.requestPermission()
    } catch {
      // Permission stays denied; the progress card still shows status.
    }
  }
}

/** Convert confirmed rows into document text lines (feeds redaction). */
export function rowsToText(rows: OcrRow[]): string {
  return rows
    .map((row) => {
      const value = row.value === null ? '' : String(row.value)
      return [row.label, value, row.unit ?? '', row.refText ?? '', row.flag ?? '']
        .filter((part) => part !== '')
        .join(' ')
    })
    .join('\n')
}

/** Convert confirmed rows into structured lab results. */
export function rowsToLabResults(rows: OcrRow[]): import('../labs/parseRows').LabResult[] {
  return rows.map((row) => ({
    test: row.label,
    value: row.value,
    unit: row.unit,
    refLow: row.refLow,
    refHigh: row.refHigh,
    refText: row.refText,
    flag: row.flag,
    page: 1,
  }))
}
