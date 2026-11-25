/**
 * Embedding worker: runs transformers.js entirely off the main thread.
 *
 * The model is Xenova/all-MiniLM-L6-v2 (the library's v4 docs pair this
 * model family with onnx-community/all-MiniLM-L6-v2-ONNX); embeddings are
 * mean-pooled and L2-normalized. Model weights are fetched from the HF CDN
 * once and cached by the browser; nothing about the DOCUMENT leaves the
 * device — only anonymous model-file downloads.
 */
import { pipeline, env, type FeatureExtractionPipeline } from '@huggingface/transformers'

// Never try to load local model files; fetch from the HF CDN instead.
env.allowLocalModels = false

export const EMBED_MODEL = 'onnx-community/all-MiniLM-L6-v2-ONNX'

let extractor: FeatureExtractionPipeline | undefined

async function getExtractor(): Promise<FeatureExtractionPipeline> {
  extractor ??= await pipeline('feature-extraction', EMBED_MODEL, { dtype: 'q8' })
  return extractor
}

interface EmbedRequest {
  id: number
  texts: string[]
}

interface EmbedResponse {
  id: number
  vectors?: Float32Array[]
  error?: string
}

self.onmessage = async (event: MessageEvent<EmbedRequest>) => {
  const { id, texts } = event.data
  try {
    const extract = await getExtractor()
    const output = await extract(texts, { pooling: 'mean', normalize: true })
    const dims = output.dims as number[]
    const rows = dims.length === 2 ? dims[0] : 1
    const dim = dims[dims.length - 1]
    const data = output.data as Float32Array
    const vectors: Float32Array[] = []
    for (let i = 0; i < rows; i++) {
      vectors.push(data.slice(i * dim, (i + 1) * dim))
    }
    const response: EmbedResponse = { id, vectors }
    self.postMessage(response)
  } catch (err) {
    const response: EmbedResponse = { id, error: err instanceof Error ? err.message : String(err) }
    self.postMessage(response)
  }
}
