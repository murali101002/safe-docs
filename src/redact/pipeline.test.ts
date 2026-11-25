import { describe, expect, it } from 'vitest'
import { approveRedactions, applyTokens, detectRedactions, rehydrate } from './pipeline'
import type { RedactionSpan } from './types'

const DOC = [
  'Patient: Jane Testpatient',
  'DOB: 01/15/1960',
  'Hemoglobin 13.5 g/dL 12.0-15.5',
].join('\n')

const NAME_SPAN: RedactionSpan = {
  id: 's0',
  start: DOC.indexOf('Jane Testpatient'),
  end: DOC.indexOf('Jane Testpatient') + 'Jane Testpatient'.length,
  type: 'NAME',
}
const DOB_SPAN: RedactionSpan = {
  id: 's1',
  start: DOC.indexOf('01/15/1960'),
  end: DOC.indexOf('01/15/1960') + '01/15/1960'.length,
  type: 'DOB',
}

const noNano = { useNano: false }

describe('detectRedactions', () => {
  it('merges regex spans deterministically', async () => {
    const spans = await detectRedactions(DOC, noNano)
    expect(spans.map((s) => DOC.slice(s.start, s.end))).toEqual([
      'Jane Testpatient',
      '01/15/1960',
    ])
    expect(spans.map((s) => s.type)).toEqual(['NAME', 'DOB'])
  })

  it('merges Nano findings and skips overlaps with regex spans', async () => {
    const doc =
      'Patient: Jane Testpatient\nDOB: 01/15/1960\nReviewed by Dr. Sam Tests.'
    const spans = await detectRedactions(doc, {
      generate: async () => ({
        text: JSON.stringify([
          // "Jane Testpatient" overlaps the deterministic Patient line —
          // the regex span must win and no duplicate span may appear.
          { text: 'Jane Testpatient', type: 'NAME' },
          { text: 'Dr. Sam Tests', type: 'NAME' },
        ]),
      }),
    })
    const slices = spans.map((s) => doc.slice(s.start, s.end))
    expect(slices).toContain('Dr. Sam Tests')
    expect(slices.filter((s) => s === 'Jane Testpatient')).toHaveLength(1)
  })

  it('redacts every occurrence of a repeated Nano finding', async () => {
    const doc = 'Jane Testpatient reviewed by Jane Testpatient.'
    const spans = await detectRedactions(doc, {
      generate: async () => ({
        text: JSON.stringify([{ text: 'Jane Testpatient', type: 'NAME' }]),
      }),
    })
    expect(spans).toHaveLength(2)
    expect(
      spans.every((s) => doc.slice(s.start, s.end) === 'Jane Testpatient'),
    ).toBe(true)
  })

  it('discards Nano output that fails zod validation', async () => {
    const spans = await detectRedactions(DOC, {
      generate: async () => ({
        text: JSON.stringify([
          { text: 'x', type: 'NAME' }, // too short
          { text: 'Dr. Sam Tests' }, // missing type
          { text: '01/15/1960', type: 'NAME' }, // a date is not a name
          { text: 'Dr. Sam Tests', type: 'NAME' }, // valid
        ]),
      }),
    })
    const slices = spans.map((s) => DOC.slice(s.start, s.end))
    expect(slices).toEqual(['Jane Testpatient', '01/15/1960'])
  })

  it('falls back to regex-only when the on-device model fails', async () => {
    const spans = await detectRedactions(DOC, {
      generate: async () => {
        throw new Error('no on-device model')
      },
    })
    expect(spans.map((s) => DOC.slice(s.start, s.end))).toEqual([
      'Jane Testpatient',
      '01/15/1960',
    ])
  })
})

describe('applyTokens / approveRedactions', () => {
  it('shares one token for repeated values and numbers per type', () => {
    const text = 'Jane Testpatient saw Jane Testpatient and Sam Tests.'
    const spans: RedactionSpan[] = [
      { id: 'a', start: 0, end: 16, type: 'NAME' },
      { id: 'b', start: 21, end: 37, type: 'NAME' },
      { id: 'c', start: 42, end: 51, type: 'NAME' },
    ]
    const { redactedText, tokenMap } = applyTokens(text, spans)
    expect(redactedText).toBe('[NAME_1] saw [NAME_1] and [NAME_2].')
    expect(tokenMap).toEqual([
      { token: '[NAME_1]', type: 'NAME', value: 'Jane Testpatient' },
      { token: '[NAME_2]', type: 'NAME', value: 'Sam Tests' },
    ])
  })

  it('drops spans the user removed', () => {
    const approved = approveRedactions(DOC, 'doc-1', [NAME_SPAN, DOB_SPAN], new Set(['s0']))
    expect(approved.tokenMap.map((t) => t.token)).toEqual(['[NAME_1]'])
    expect(approved.redacted.text).not.toContain('[DOB_1]')
    expect(approved.redacted.text).toContain('01/15/1960')
  })

  it('produces a RedactedText and round-trips through rehydrate', async () => {
    const spans = await detectRedactions(DOC, noNano)
    const ids = new Set(spans.map((s) => s.id))
    const approved = approveRedactions(DOC, 'doc-1', spans, ids)
    expect(approved.redacted.text).toBe(
      'Patient: [NAME_1]\nDOB: [DOB_1]\nHemoglobin 13.5 g/dL 12.0-15.5',
    )
    expect(rehydrate(approved.redacted.text, approved.tokenMap)).toBe(DOC)
  })

  it('resolves overlapping custom and auto spans (longer wins)', () => {
    const text = 'Mail to 123 Main Street, Springfield, IL 62704 today'
    const zipStart = text.indexOf('62704')
    const spans: RedactionSpan[] = [
      { id: 'zip', start: zipStart, end: zipStart + 5, type: 'ZIP' },
      {
        id: 'addr',
        start: text.indexOf('123 Main Street'),
        end: zipStart + 5,
        type: 'ADDRESS',
      },
    ]
    const { redactedText } = applyTokens(text, spans)
    expect(redactedText).toBe('Mail to [ADDRESS_1] today')
  })
})
