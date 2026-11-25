import { parseOcrRows, OCR_PROMPT, type OcrRow } from './extract'
import { processImageBlob, type ProcessedImage } from './imageUtils'
import type { OnDeviceImage } from '../ai/hybrid'

/**
 * Background scan queue (feature 08): photos are preprocessed in a Web
 * Worker and read by the on-device model ONLY, one at a time, with a
 * subscribable progress list for the UI progress card. A browser
 * Notification fires when the queue drains.
 */

export type ScanStatus = 'queued' | 'processing' | 'done' | 'failed'

export interface ScanItem {
  id: number
  name: string
  status: ScanStatus
  error?: string
  rows?: OcrRow[]
}

export const NANO_UNAVAILABLE_MESSAGE =
  'Photo scanning needs on-device AI in Chrome; please upload a text PDF.'

export interface ScanQueueOptions {
  /** Inject the vision generator for tests; defaults to on-device ONLY. */
  generateVision?: (
    prompt: string,
    image: OnDeviceImage,
  ) => Promise<{ text: string }>
  /** Inject preprocessing for tests; defaults to the image worker. */
  preprocess?: (file: Blob) => Promise<ProcessedImage>
  /** Inject the notifier for tests; defaults to the Notification API. */
  notify?: (title: string, body: string) => void
}

class WorkerPreprocessor {
  private worker: Worker
  private pending = new Map<number, { resolve: (v: ProcessedImage) => void; reject: (e: Error) => void }>()
  private nextId = 1

  constructor() {
    this.worker = new Worker(new URL('./image.worker.ts', import.meta.url), {
      type: 'module',
    })
    this.worker.onmessage = (event: MessageEvent) => {
      const { id, error, ...processed } = event.data as {
        id: number
        error?: string
        base64?: string
        mimeType?: string
      }
      const request = this.pending.get(id)
      if (request === undefined) return
      this.pending.delete(id)
      if (error !== undefined || processed.base64 === undefined) {
        request.reject(new Error(error ?? 'image preprocessing failed'))
      } else {
        request.resolve({ base64: processed.base64, mimeType: processed.mimeType ?? 'image/jpeg' })
      }
    }
  }

  preprocess(file: Blob): Promise<ProcessedImage> {
    const id = this.nextId++
    return new Promise<ProcessedImage>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.worker.postMessage({ id, blob: file })
    })
  }
}

let workerPreprocessor: WorkerPreprocessor | null = null

/** Default notifier: the Notification API (only when permitted). */
function defaultNotify(title: string, body: string): void {
  if (typeof Notification === 'undefined') return
  if (Notification.permission === 'granted') {
    new Notification(title, { body })
  }
}

/**
 * Create a scan queue. Photos are processed ONE at a time (queued →
 * processing → done/failed) so the progress card is predictable and the
 * on-device model is never hammered.
 */
export function createScanQueue(options: ScanQueueOptions = {}) {
  let preprocess = options.preprocess
  if (preprocess === undefined && typeof Worker !== 'undefined') {
    workerPreprocessor ??= new WorkerPreprocessor()
    const worker = workerPreprocessor
    preprocess = (file) => worker.preprocess(file)
  }
  preprocess ??= processImageBlob
  const preprocessFile = preprocess

  const generateVision =
    options.generateVision ??
    (async (prompt: string, image: OnDeviceImage) => {
      const { generateOnDevice } = await import('../ai/hybrid')
      return generateOnDevice(prompt, image)
    })

  const notify = options.notify ?? defaultNotify

  let items: ScanItem[] = []
  const files = new Map<number, Blob>()
  let nextId = 1
  let processing = false
  const listeners = new Set<(items: ScanItem[]) => void>()

  function emit(): void {
    for (const listener of listeners) listener([...items])
  }

  function friendlyError(err: unknown): string {
    const message = err instanceof Error ? err.message : String(err)
    if (
      /on-device|unavailable|not supported|LanguageModel|only_on_device/i.test(
        message,
      )
    ) {
      return NANO_UNAVAILABLE_MESSAGE
    }
    return message
  }

  async function processOne(item: ScanItem, file: Blob): Promise<void> {
    item.status = 'processing'
    emit()
    try {
      const image = await preprocessFile(file)
      const { text } = await generateVision(OCR_PROMPT, image)
      const { rows } = parseOcrRows(text)
      item.rows = rows
      item.status = 'done'
      emit()
    } catch (err) {
      item.status = 'failed'
      item.error = friendlyError(err)
      emit()
    }
  }

  async function drain(): Promise<void> {
    if (processing) return
    processing = true
    try {
      // Process until nothing is queued — items enqueued while we work are
      // picked up by this loop, not left behind.
      for (;;) {
        const item = items.find((candidate) => candidate.status === 'queued')
        if (item === undefined) break
        const file = files.get(item.id)
        if (file === undefined) {
          item.status = 'failed'
          item.error = 'missing file'
          emit()
          continue
        }
        await processOne(item, file)
      }
    } finally {
      processing = false
      // Queue drained: notify once if anything finished.
      const done = items.filter((item) => item.status === 'done').length
      const failed = items.filter((item) => item.status === 'failed').length
      if (done + failed > 0) {
        notify(
          'SafeDocs',
          `Photo scan complete — ${done} read, ${failed} failed. Review the extracted values.`,
        )
      }
    }
  }

  return {
    /** Enqueue a photo for on-device reading. Returns the item id. */
    enqueue(file: Blob, name: string): number {
      const id = nextId++
      files.set(id, file)
      const item: ScanItem = { id, name, status: 'queued' }
      items.push(item)
      emit()
      void drain()
      return id
    },
    subscribe(listener: (items: ScanItem[]) => void): () => void {
      listeners.add(listener)
      listener([...items])
      return () => listeners.delete(listener)
    },
    /** All successfully read rows across the queue, in order. */
    doneRows(): OcrRow[] {
      return items.filter((item) => item.status === 'done').flatMap((item) => item.rows ?? [])
    },
    snapshot(): ScanItem[] {
      return [...items]
    },
  }
}

export type ScanQueue = ReturnType<typeof createScanQueue>
