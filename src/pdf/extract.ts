import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

// The worker URL is only meaningful in a browser. In Node (golden tests) the
// legacy build resolves its fake worker relative to its own module file.
if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl
}

/** One positioned text fragment from a PDF page. */
export interface PdfTextItem {
  text: string
  x: number
  y: number
  page: number
}

/** A row of cells clustered from text items sharing a baseline. */
export type PdfRow = PdfTextItem[]

/**
 * Extract positioned text items from every page of a PDF.
 *
 * pdf.js reports each item's position via its transform matrix; x is
 * transform[4] and y is transform[5] (baseline origin, PDF coords grow
 * upward — we keep pdf.js's values as-is for clustering).
 */
export async function extractTextItems(
  data: ArrayBuffer | Uint8Array,
): Promise<PdfTextItem[]> {
  // pdf.js insists on plain Uint8Array (a Node Buffer is rejected), and the
  // buffer must not be a view we keep using afterwards.
  const bytes = data instanceof Uint8Array ? new Uint8Array(data) : new Uint8Array(data)
  const task = pdfjsLib.getDocument({ data: bytes })
  const doc = await task.promise
  const items: PdfTextItem[] = []
  try {
    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      const page = await doc.getPage(pageNum)
      const content = await page.getTextContent()
      for (const item of content.items) {
        if (!('str' in item) || item.str.trim() === '') continue
        items.push({
          text: item.str,
          x: item.transform[4],
          y: item.transform[5],
          page: pageNum,
        })
      }
    }
  } finally {
    await task.destroy()
  }
  return items
}

/** Y tolerance (PDF units) under which items count as the same row. */
export const ROW_TOLERANCE = 3

/**
 * Cluster flat text items into table rows.
 *
 * Items are grouped per page: sorted by y (descending — PDF y grows upward)
 * and folded into rows while their y stays within ROW_TOLERANCE of the
 * row's baseline; within a row, cells are ordered left-to-right by x.
 */
export function groupRows(items: PdfTextItem[]): PdfRow[] {
  const byPage = new Map<number, PdfTextItem[]>()
  for (const item of items) {
    const pageItems = byPage.get(item.page)
    if (pageItems) pageItems.push(item)
    else byPage.set(item.page, [item])
  }

  const rows: PdfRow[] = []
  for (const pageItems of byPage.values()) {
    const sorted = [...pageItems].sort((a, b) => b.y - a.y || a.x - b.x)
    let current: PdfTextItem[] = []
    let currentY: number | undefined
    for (const item of sorted) {
      if (currentY === undefined || Math.abs(item.y - currentY) <= ROW_TOLERANCE) {
        current.push(item)
        currentY = currentY ?? item.y
      } else {
        rows.push(current.sort((a, b) => a.x - b.x))
        current = [item]
        currentY = item.y
      }
    }
    if (current.length > 0) rows.push(current.sort((a, b) => a.x - b.x))
  }
  return rows
}
