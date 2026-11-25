import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createScanQueue } from '../../src/ocr/scanQueue'
import { arrayBufferToBase64 } from '../../src/ocr/imageUtils'

/** Minimal JPEG-ish blob stub (the queue never decodes it in tests). */
function fakePhoto(): Blob {
  return new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' })
}

describe('createScanQueue (background, on-device only)', () => {
  function makeQueue(overrides: {
    generateVision?: (prompt: string, image: { base64: string; mimeType: string }) => Promise<{ text: string }>
    notify?: (title: string, body: string) => void
  }) {
    const preprocessed: Array<{ base64: string; mimeType: string }> = []
    return createScanQueue({
      preprocess: async () => {
        const image = { base64: 'AAAA', mimeType: 'image/jpeg' }
        preprocessed.push(image)
        return image
      },
      ...overrides,
    })
  }

  it('processes photos in order and reports parsed rows', async () => {
    const notifications: string[] = []
    const queue = makeQueue({
      generateVision: async (prompt) => {
        expect(prompt).toContain('Copy every number EXACTLY')
        return {
          text: JSON.stringify([
            { label: 'Hemoglobin', value: 13.5, unit: 'g/dL', refLow: 12, refHigh: 15.5, refText: '12.0-15.5', flag: 'N' },
          ]),
        }
      },
      notify: (_t, body) => notifications.push(body),
    })
    const seen: string[][] = []
    queue.subscribe((items) => seen.push(items.map((i) => i.status)))
    queue.enqueue(fakePhoto(), 'scan.jpg')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(queue.doneRows()).toHaveLength(1)
    expect(queue.snapshot()[0].status).toBe('done')
    expect(notifications.length).toBe(1)
    expect(notifications[0]).toMatch(/Photo scan complete/)
    // The item went through queued → processing → done (the first emission
    // is the subscriber's initial empty snapshot).
    const transitions = seen.filter((statuses) => statuses.length > 0)
    expect(transitions[0]).toEqual(['queued'])
    expect(transitions.at(-1)).toEqual(['done'])
  })

  it('fails with the friendly message when the on-device model is unavailable — never the cloud', async () => {
    const queue = makeQueue({
      generateVision: async () => {
        throw new Error('on-device model is not available in this browser')
      },
    })
    queue.enqueue(fakePhoto(), 'scan.jpg')
    await new Promise((resolve) => setTimeout(resolve, 20))
    const item = queue.snapshot()[0]
    expect(item.status).toBe('failed')
    expect(item.error).toBe(
      'Photo scanning needs on-device AI in Chrome; please upload a text PDF.',
    )
    expect(queue.doneRows()).toEqual([])
  })

  it('a model that tries to route to the cloud fails the item', async () => {
    const queue = makeQueue({
      generateVision: async () => {
        throw new Error('On-device guard violated: response ran in the cloud')
      },
    })
    queue.enqueue(fakePhoto(), 'scan.jpg')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(queue.snapshot()[0].status).toBe('failed')
    expect(queue.snapshot()[0].error).toMatch(/needs on-device AI/)
  })

  it('keeps processing the queue when one item fails', async () => {
    let calls = 0
    const queue = makeQueue({
      generateVision: async () => {
        calls++
        if (calls === 1) throw new Error('transient on-device failure')
        return {
          text: JSON.stringify([
            { label: 'Glucose', value: 92, unit: 'mg/dL', refLow: 70, refHigh: 99, refText: '70-99', flag: 'N' },
          ]),
        }
      },
    })
    queue.enqueue(fakePhoto(), 'bad.jpg')
    queue.enqueue(fakePhoto(), 'good.jpg')
    await new Promise((resolve) => setTimeout(resolve, 30))
    const statuses = queue.snapshot().map((item) => item.status)
    expect(statuses).toEqual(['failed', 'done'])
    expect(queue.doneRows()).toHaveLength(1)
  })

  it('discards invalid vision output (no rows, item still done)', async () => {
    const queue = makeQueue({
      generateVision: async () => ({ text: 'no json here' }),
    })
    queue.enqueue(fakePhoto(), 'blurry.jpg')
    await new Promise((resolve) => setTimeout(resolve, 20))
    const item = queue.snapshot()[0]
    expect(item.status).toBe('done')
    expect(item.rows).toEqual([])
  })
})

describe('arrayBufferToBase64', () => {
  it('encodes bytes correctly', () => {
    // Node has no btoa in this scope — polyfill via Buffer for the test env.
    const bytes = new Uint8Array([104, 105]).buffer
    ;(globalThis as { btoa?: (s: string) => string }).btoa ??= (s: string) =>
      Buffer.from(s, 'binary').toString('base64')
    expect(arrayBufferToBase64(bytes)).toBe(Buffer.from([104, 105]).toString('base64'))
  })
})

describe('source guards (feature 08 privacy)', () => {
  const ROOT = join(import.meta.dirname, '..', '..')
  const FILES = [
    'src/ocr/extract.ts',
    'src/ocr/scanQueue.ts',
    'src/ocr/image.worker.ts',
    'src/ocr/imageUtils.ts',
  ]

  it('the OCR stack never touches the cloud path', () => {
    for (const file of FILES) {
      const src = readFileSync(join(ROOT, file), 'utf8')
      expect(src, `${file} must not use sendToCloud`).not.toContain('sendToCloud')
      expect(src, `${file} must not import cloud.ts`).not.toMatch(/from\s+['"][^'"]*ai\/cloud/)
      expect(src, `${file} must not import firebase`).not.toMatch(/from\s+['"][^'"]*firebase/)
    }
    // The default vision generator must be the on-device one, lazily.
    const queue = readFileSync(join(ROOT, 'src', 'ocr', 'scanQueue.ts'), 'utf8')
    expect(queue).toContain("import('../ai/hybrid')")
    expect(queue).toContain('generateOnDevice')
  })
})
