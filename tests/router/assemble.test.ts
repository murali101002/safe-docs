import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import {
  assembleCloudContext,
  rehydrate,
} from '../../src/redact/pipeline'
import type { CloudContextDoc } from '../../src/redact/pipeline'

describe('assembleCloudContext (multi-doc token renumbering)', () => {
  const docA: CloudContextDoc = {
    docId: 'a.pdf::1',
    text: 'Patient: [NAME_1] with A1C 6.7%',
    tokenMap: [{ token: '[NAME_1]', type: 'NAME', value: 'Jane Testpatient' }],
  }
  const docB: CloudContextDoc = {
    docId: 'b.pdf::2',
    text: 'Reviewed by [NAME_1], phone [PHONE_1].',
    tokenMap: [
      { token: '[NAME_1]', type: 'NAME', value: 'Dr. Sam Tests' },
      { token: '[PHONE_1]', type: 'PHONE', value: '555-123-4567' },
    ],
  }

  it('renumbers colliding tokens across docs', () => {
    const { redacted } = assembleCloudContext([docA, docB])
    // doc B's [NAME_1] must become [NAME_2] (next global number for NAME);
    // doc A keeps [NAME_1].
    expect(redacted.text).toContain('[NAME_1] with A1C')
    expect(redacted.text).toContain('[NAME_2], phone [PHONE_1]')
    expect(redacted.text).not.toContain('Dr. Sam Tests')
  })

  it('the merged map rehydrates the combined answer correctly', () => {
    const { redacted, tokenMap } = assembleCloudContext([docA, docB])
    expect(tokenMap.map((t) => t.token)).toEqual([
      '[NAME_1]',
      '[NAME_2]',
      '[PHONE_1]',
    ])
    expect(tokenMap[1].value).toBe('Dr. Sam Tests')
    const answer =
      'A1C was high in [NAME_1]\'s record; [NAME_2] reviewed it and left [PHONE_1].'
    expect(rehydrate(answer, tokenMap)).toBe(
      "A1C was high in Jane Testpatient's record; Dr. Sam Tests reviewed it and left 555-123-4567.",
    )
    // The assembled context itself must not contain raw values.
    expect(redacted.text).not.toContain('Jane Testpatient')
  })

  it('returns a branded RedactedText usable by the cloud gate', () => {
    const { redacted } = assembleCloudContext([docA])
    expect(redacted.docId).toBe('a.pdf::1')
    expect(Object.keys(redacted)).toContain('text')
  })

  it('throws when there is no content at all', () => {
    expect(() => assembleCloudContext([{ docId: 'x', text: '  ', tokenMap: [] }])).toThrow(
      /no approved redacted content/,
    )
  })

  it('skips empty docs but keeps non-empty ones', () => {
    const { redacted } = assembleCloudContext([docA, { docId: 'empty', text: '', tokenMap: [] }])
    expect(redacted.text).not.toContain('empty')
  })
})
