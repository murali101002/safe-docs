import { describe, expect, it } from 'vitest'
import { extractJsonArray, nanoFindings } from './nanoRedact'

describe('extractJsonArray', () => {
  it('tolerates fences and prose', () => {
    expect(extractJsonArray('```json\n[{"text":"A","type":"NAME"}]\n```')).toEqual([
      { text: 'A', type: 'NAME' },
    ])
  })
  it('throws without an array', () => {
    expect(() => extractJsonArray('nothing here')).toThrow()
  })
})

describe('nanoFindings', () => {
  it('returns validated findings in order', async () => {
    const findings = await nanoFindings('irrelevant', async (prompt) => {
      expect(prompt).toContain('Return ONLY a JSON array')
      return {
        text: JSON.stringify([
          { text: 'Jane Testpatient', type: 'NAME' },
          { text: '123 Main Street', type: 'ADDRESS' },
        ]),
      }
    })
    expect(findings).toEqual([
      { text: 'Jane Testpatient', type: 'NAME' },
      { text: '123 Main Street', type: 'ADDRESS' },
    ])
  })

  it('discards invalid items and dedupes case-insensitively', async () => {
    const findings = await nanoFindings('irrelevant', async () => ({
      text: JSON.stringify([
        { text: 'Jane Testpatient', type: 'NAME' },
        { text: 'jane testpatient', type: 'NAME' }, // duplicate, different case
        { text: '9', type: 'NAME' }, // too short
        { text: 'Jane Testpatient', type: 'PHONE' }, // bad type
        { text: '123 Main Street', type: 'ADDRESS' },
      ]),
    }))
    expect(findings).toEqual([{ text: 'Jane Testpatient', type: 'NAME' }, { text: '123 Main Street', type: 'ADDRESS' }])
  })

  it('caps the number of findings', async () => {
    const items = Array.from({ length: 60 }, (_, i) => ({
      text: `Person Number ${String(i).padStart(2, '0')}`,
      type: 'NAME' as const,
    }))
    const findings = await nanoFindings('irrelevant', async () => ({
      text: JSON.stringify(items),
    }))
    expect(findings.length).toBeLessThanOrEqual(30)
  })

  it('returns [] for non-array output', async () => {
    const findings = await nanoFindings('irrelevant', async () => ({
      text: '{"findings": []}',
    }))
    expect(findings).toEqual([])
  })

  it('propagates on-device unavailability', async () => {
    await expect(
      nanoFindings('irrelevant', async () => {
        throw new Error('on-device model unavailable')
      }),
    ).rejects.toThrow('on-device model unavailable')
  })
})
