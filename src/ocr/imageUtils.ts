/**
 * Image preprocessing helpers for the OCR pipeline. Shared so tests can
 * verify the base64 encoding without a browser.
 */

/** Encode an ArrayBuffer as base64 (btoa in chunks to avoid arg limits). */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/** Longest edge cap for scanned pages (keeps Nano input small). */
export const MAX_SCAN_EDGE = 1280

export interface ProcessedImage {
  base64: string
  mimeType: string
}

/**
 * Decode, downscale to MAX_SCAN_EDGE, re-encode as JPEG. Runs inside the
 * image worker via OffscreenCanvas; the main thread never decodes the
 * bitmap.
 */
export async function processImageBlob(
  blob: Blob,
  decode = (b: Blob) => createImageBitmap(b),
): Promise<ProcessedImage> {
  const bitmap = await decode(blob)
  try {
    const scale = Math.min(1, MAX_SCAN_EDGE / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')
    if (ctx === null) throw new Error('OffscreenCanvas 2D context unavailable')
    ctx.drawImage(bitmap, 0, 0, width, height)
    const out = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 })
    return { base64: arrayBufferToBase64(await out.arrayBuffer()), mimeType: 'image/jpeg' }
  } finally {
    bitmap.close()
  }
}
