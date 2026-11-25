/// <reference lib="webworker" />
import { processImageBlob } from './imageUtils'

/**
 * Image preprocessing worker: decode + downscale + JPEG re-encode off the
 * main thread, so a phone photo never blocks the UI.
 */

interface PreprocessRequest {
  id: number
  blob: Blob
}

self.onmessage = async (event: MessageEvent<PreprocessRequest>) => {
  const { id, blob } = event.data
  try {
    const processed = await processImageBlob(blob)
    self.postMessage({ id, ...processed })
  } catch (err) {
    self.postMessage({
      id,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
