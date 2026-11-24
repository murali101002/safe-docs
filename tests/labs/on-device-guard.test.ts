import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Source-level guard for hard rule 1: anything that may contain PII must
 * only run on-device. nanoCleanup handles raw (unredacted) table rows, so
 * it must use the ONLY_ON_DEVICE path and never the hybrid cloud fallback.
 *
 * The real choke-point enforcement (branded RedactedText type gating the
 * cloud call) lands with feature 04-redaction; this keeps F3 honest until
 * then and guards against regressions afterwards.
 */

const ROOT = join(import.meta.dirname, '..', '..')
const hybridSrc = readFileSync(join(ROOT, 'src', 'ai', 'hybrid.ts'), 'utf8')
const nanoSrc = readFileSync(join(ROOT, 'src', 'labs', 'nanoCleanup.ts'), 'utf8')

/** Body of generateOnDevice (from its declaration to its closing brace). */
function onDeviceBody(): string {
  const start = hybridSrc.indexOf('export async function generateOnDevice')
  expect(start, 'generateOnDevice exists in src/ai/hybrid.ts').toBeGreaterThan(-1)
  const end = hybridSrc.indexOf('\n}\n', start)
  return hybridSrc.slice(start, end === -1 ? undefined : end)
}

describe('on-device guard for raw text', () => {
  it('generateOnDevice uses InferenceMode.ONLY_ON_DEVICE', () => {
    const body = onDeviceBody()
    expect(body).toContain('InferenceMode.ONLY_ON_DEVICE')
    // No silent cloud fallback and no cloud params on this path.
    expect(body).not.toContain('PREFER_ON_DEVICE')
    expect(body).not.toContain('inCloudParams')
  })

  it('generateOnDevice refuses responses that report cloud inference', () => {
    expect(onDeviceBody()).toContain('InferenceSource.IN_CLOUD')
  })

  it('nanoCleanup reaches only the on-device generator, not the hybrid one', () => {
    // The on-device module is loaded lazily (no Firebase config needed to
    // import nanoCleanup), and only the ONLY_ON_DEVICE path is reachable.
    expect(nanoSrc).toMatch(/import\(['"]\.\.\/ai\/hybrid['"]\)/)
    expect(nanoSrc).toContain('generateOnDevice')
    // No static import of the hybrid module (PREFER_ON_DEVICE generate()
    // must never be reachable from the raw-rows cleanup path).
    expect(nanoSrc).not.toMatch(/import\s*\{[^}]*\}\s*from\s*['"]\.\.\/ai\/hybrid['"]/)
    // And the default generator must be the on-device one.
    expect(nanoSrc).toContain('options.generate ?? defaultGenerate')
  })
})
