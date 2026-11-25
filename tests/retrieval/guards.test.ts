import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Guards for the retrieval stack:
 * - embeddings and their cache never touch Firebase or Firestore (hard
 *   rule 3 — they stay in IndexedDB on this device),
 * - the default embedder runs transformers.js in a Web Worker, and
 * - retrieval code never routes through the LLM modules (it is local ML).
 */

const ROOT = join(import.meta.dirname, '..', '..')
const FILES = [
  'src/retrieval/chunk.ts',
  'src/retrieval/search.ts',
  'src/retrieval/embedCache.ts',
  'src/retrieval/embedder.ts',
  'src/retrieval/indexer.ts',
  'src/retrieval/embed.worker.ts',
  'src/storage/db.ts',
]

describe('retrieval privacy guards', () => {
  it('never imports Firebase anywhere in the retrieval stack', () => {
    for (const file of FILES) {
      const src = readFileSync(join(ROOT, file), 'utf8')
      expect(src, `${file} must not import firebase`).not.toMatch(
        /from\s+['"][^'"]*firebase/,
      )
      expect(src, `${file} must not mention firestore`).not.toContain('firestore')
    }
  })

  it('the worker embedder loads the model in a Web Worker via transformers.js', () => {
    const worker = readFileSync(join(ROOT, 'src', 'retrieval', 'embed.worker.ts'), 'utf8')
    expect(worker).toContain("@huggingface/transformers")
    expect(worker).toContain("pipeline('feature-extraction'")
    expect(worker).toContain("pooling: 'mean'")
    expect(worker).toContain('normalize: true')
    const embedder = readFileSync(join(ROOT, 'src', 'retrieval', 'embedder.ts'), 'utf8')
    expect(embedder).toContain('new Worker(new URL(')
    expect(embedder).toContain("import.meta.url")
  })

  it('the shared database module stays Firebase-free too', () => {
    const db = readFileSync(join(ROOT, 'src', 'storage', 'db.ts'), 'utf8')
    expect(db).not.toMatch(/from\s+['"][^'"]*firebase/)
  })
})
