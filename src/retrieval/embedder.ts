/**
 * Embedder: normalized sentence embeddings for retrieval.
 *
 * Default implementation runs transformers.js (Xenova/all-MiniLM-L6-v2) in
 * a Web Worker so the main thread stays responsive. Tests inject a fake
 * embed function — the real model never runs in Node/CI.
 */

export const EMBED_MODEL = 'onnx-community/all-MiniLM-L6-v2-ONNX'

export type EmbedFn = (texts: string[]) => Promise<Float32Array[]>

export interface Embedder {
  embed: EmbedFn
}

interface PendingRequest {
  resolve: (vectors: Float32Array[]) => void
  reject: (err: Error) => void
}

class WorkerEmbedder implements Embedder {
  private worker: Worker
  private pending = new Map<number, PendingRequest>()
  private nextId = 1

  constructor() {
    this.worker = new Worker(new URL('./embed.worker.ts', import.meta.url), {
      type: 'module',
    })
    this.worker.onmessage = (event: MessageEvent) => {
      const { id, vectors, error } = event.data as {
        id: number
        vectors?: Float32Array[]
        error?: string
      }
      const request = this.pending.get(id)
      if (request === undefined) return
      this.pending.delete(id)
      if (error !== undefined) request.reject(new Error(error))
      else request.resolve(vectors ?? [])
    }
    this.worker.onerror = (event) => {
      const err = new Error(`embedding worker failed: ${event.message}`)
      for (const request of this.pending.values()) request.reject(err)
      this.pending.clear()
    }
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return []
    const id = this.nextId++
    return new Promise<Float32Array[]>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.worker.postMessage({ id, texts })
    })
  }
}

/** Embedder backed by the transformers.js Web Worker. */
export function createWorkerEmbedder(): Embedder {
  return new WorkerEmbedder()
}

/** Build an embedder, optionally with an injected embed function for tests. */
export function createEmbedder(options: { embed?: EmbedFn } = {}): Embedder {
  return options.embed !== undefined
    ? { embed: options.embed }
    : createWorkerEmbedder()
}
