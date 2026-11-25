import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Guards for the intelligence features (feature 06):
 * - every on-device intelligence path uses the ONLY_ON_DEVICE generator
 *   (lazily imported) and never the hybrid cloud path or the cloud choke
 *   point — answers must work fully in airplane mode;
 * - every prompt builder carries the diagnosis refusal + disclaimer rules.
 */

const ROOT = join(import.meta.dirname, '..', '..')
const MODULES = [
  'src/intelligence/qa.ts',
  'src/intelligence/explain.ts',
  'src/intelligence/doctorQuestions.ts',
  'src/intelligence/summary.ts',
]

describe('intelligence privacy guards', () => {
  it('reaches only the on-device generator, lazily, never the cloud', () => {
    for (const file of MODULES) {
      const src = readFileSync(join(ROOT, file), 'utf8')
      // The generator always comes from the shared on-device resolver
      // (options.ts), which lazy-imports the ONLY_ON_DEVICE generator.
      expect(src, `${file} must use resolveGenerate for the model call`).toContain(
        'resolveGenerate',
      )
      // No static import of the hybrid module and no use of the cloud
      // choke point from intelligence code.
      expect(src, `${file} must not statically import ai/hybrid`).not.toMatch(
        /import\s*\{[^}]*\}\s*from\s*['"]\.\.\/ai\/hybrid['"]/,
      )
      expect(src, `${file} must not use sendToCloud`).not.toContain('sendToCloud')
      expect(src, `${file} must not import firebase`).not.toMatch(
        /from\s+['"][^'"]*firebase/,
      )
    }
  })

  it('the shared generator defaults to the on-device model only', () => {
    const options = readFileSync(join(ROOT, 'src', 'intelligence', 'options.ts'), 'utf8')
    expect(options).toContain('generateOnDevice')
    expect(options).toContain("import('../ai/hybrid')")
    expect(options).toContain('NEVER diagnose')
    expect(options).toContain('Informational only')
    expect(options).not.toContain('sendToCloud')
  })

  it('every prompt builder includes the shared safety rules', () => {
    for (const file of MODULES) {
      const src = readFileSync(join(ROOT, file), 'utf8')
      expect(src, `${file} must include SAFETY_RULES`).toContain('SAFETY_RULES')
    }
  })
})
