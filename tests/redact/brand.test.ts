import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  createRedactedText,
  isRedactedText,
  requireRedacted,
  type RedactedText,
} from '../../src/redact/brand'
import { sendToCloud, scrubQuestion } from '../../src/ai/cloud'

/**
 * Guard tests for hard rules 1 and 3:
 * - raw text cannot reach the cloud path (branded RedactedText, enforced at
 *   compile time AND run time), and
 * - the token map store never touches Firebase.
 */

const ROOT = join(import.meta.dirname, '..', '..')

describe('RedactedText brand (runtime)', () => {
  it('accepts approved instances', () => {
    const approved = createRedactedText({ text: 'Patient: [NAME_1]', docId: 'd1' })
    expect(isRedactedText(approved)).toBe(true)
    expect(approved.text).toBe('Patient: [NAME_1]')
  })

  it('refuses raw strings and plain objects', () => {
    expect(isRedactedText('Patient: Jane Testpatient')).toBe(false)
    expect(isRedactedText({ text: 'anything', docId: 'd1' })).toBe(false)
    expect(isRedactedText(null)).toBe(false)
  })

  it('requireRedacted throws on raw text', () => {
    expect(() => requireRedacted('raw document text')).toThrow(/raw text/)
    expect(() =>
      requireRedacted({ text: 'looks right', docId: 'd1' }),
    ).toThrow(/RedactedText/)
  })
})

describe('cloud choke point (src/ai/cloud.ts)', () => {
  it('sendToCloud refuses a raw string even if cast past the type system', async () => {
    // Deliberate `as unknown as` — proving the RUNTIME gate, not just types.
    const forged = 'Patient: Jane Testpatient, DOB: 01/15/1960' as unknown as RedactedText
    await expect(sendToCloud('question?', forged)).rejects.toThrow(/raw text|RedactedText/)
  })

  it('scrubs user-typed questions before they leave the device', () => {
    const scrubbed = scrubQuestion('Contact me at 555-123-4567 or jane@example.com')
    expect(scrubbed).toBe('Contact me at [PII_1] or [PII_2]')
    expect(scrubbed).not.toContain('555-123-4567')
    expect(scrubbed).not.toContain('jane@example.com')
  })

  it('leaves clean questions untouched', () => {
    expect(scrubQuestion('What does my A1C trend show?')).toBe(
      'What does my A1C trend show?',
    )
  })
})

describe('RedactedText brand (compile time)', () => {
  it('a plain string/object is not assignable to RedactedText', () => {
    const raw = 'Patient: Jane Testpatient'
    expectTypeOf(raw).not.toMatchTypeOf<RedactedText>()
    expectTypeOf({ text: 'x', docId: 'd' }).not.toMatchTypeOf<RedactedText>()
  })
})

describe('source guards', () => {
  it('only src/redact/brand.ts may create RedactedText instances', () => {
    // The private brand symbol must not be referenced outside brand.ts.
    const offenders = [
      'src/redact/pipeline.ts',
      'src/redact/regex.ts',
      'src/redact/nanoRedact.ts',
      'src/redact/tokenStore.ts',
      'src/ai/cloud.ts',
      'src/ai/hybrid.ts',
      'src/App.tsx',
    ]
    for (const file of offenders) {
      const src = readFileSync(join(ROOT, file), 'utf8')
      expect(src, `${file} must not touch the brand symbol`).not.toContain('REDACTED_BRAND')
      expect(src, `${file} must not construct RedactedText`).not.toMatch(/as RedactedText\b/)
    }
  })

  it('token map storage never imports Firebase (hard rule 3)', () => {
    const store = readFileSync(join(ROOT, 'src', 'redact', 'tokenStore.ts'), 'utf8')
    expect(store).not.toMatch(/from\s+['"][^'"]*firebase/)
    expect(store).not.toContain('firestore')
  })

  it('nanoRedact reaches the on-device model only, lazily', () => {
    const src = readFileSync(join(ROOT, 'src', 'redact', 'nanoRedact.ts'), 'utf8')
    expect(src).toMatch(/import\(['"]\.\.\/ai\/hybrid['"]\)/)
    expect(src).toContain('generateOnDevice')
    expect(src).not.toMatch(/import\s*\{[^}]*\}\s*from\s*['"]\.\.\/ai\/hybrid['"]/)
  })

  it('cloud model uses ONLY_IN_CLOUD with no on-device fallback', () => {
    const src = readFileSync(join(ROOT, 'src', 'ai', 'cloud.ts'), 'utf8')
    expect(src).toContain('InferenceMode.ONLY_IN_CLOUD')
    expect(src).not.toContain('PREFER_ON_DEVICE')
    expect(src).not.toContain('ONLY_ON_DEVICE')
  })
})
