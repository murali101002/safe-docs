import { describe, expect, it } from 'vitest'
import { createEmbedder } from '../../src/retrieval/embedder'
import { askHybrid, type AskScopeDoc } from '../../src/ai/hybridAsk'
import { ROUTER_DEFAULTS } from '../../src/ai/routerConfig'
import type { RedactedText } from '../../src/redact/brand'

const docId = 'report.pdf::1'

/** Deterministic "bag of initials" fake embedder for retrieval. */
function fakeEmbed(texts: string[]): Promise<Float32Array[]> {
  return Promise.resolve(
    texts.map((text) => {
      const vector = new Float32Array(8)
      for (const word of text.toLowerCase().split(/\W+/)) {
        if (word === '') continue
        vector[word.charCodeAt(0) % 8] += 1
        vector[word.length % 8] += 0.5
      }
      return vector
    }),
  )
}

const REDACTED = [
  'Patient: [NAME_1]',
  'Hemoglobin A1c 6.7 % 4.0-5.6 H extra words one two three four five six',
  'Creatinine 1.3 mg/dL 0.6-1.2 extra words seven eight nine ten eleven',
].join('\n')

const scope: AskScopeDoc[] = [
  {
    docId,
    docDate: '2026-01-15',
    redactedText: REDACTED,
    labResults: [
      {
        test: 'Hemoglobin A1c',
        value: 6.7,
        unit: '%',
        refLow: 4,
        refHigh: 5.6,
        refText: '4.0-5.6',
        flag: 'H',
        page: 1,
      },
    ],
  },
]

const embedder = createEmbedder({ embed: fakeEmbed })

function baseInput(overrides: Partial<Parameters<typeof askHybrid>[0]> = {}) {
  return {
    question: 'What was my A1C?',
    scope,
    config: { ...ROUTER_DEFAULTS, cloudEnabled: true },
    online: true,
    onDeviceAvailable: true,
    embedder,
    getMaps: async () => null,
    ...overrides,
  } as Parameters<typeof askHybrid>[0]
}

describe('askHybrid (routing orchestrator)', () => {
  it('routes a single-doc question on-device and tags the reason', async () => {
    const outcome = await askHybrid(
      baseInput({
        generate: async (prompt) => {
          expect(prompt).toContain('What was my A1C?')
          expect(prompt).toContain('Hemoglobin A1c: 6.7 % (H) — report.pdf, page 1')
          return { text: 'Your A1C was 6.7% [report.pdf, page 1].' }
        },
      }),
    )
    expect(outcome.target).toBe('device')
    expect(outcome.reason).toMatch(/Single-document/)
    expect(outcome.text).toBe('Your A1C was 6.7% [report.pdf, page 1].')
    expect(outcome.sources.length).toBeGreaterThan(0)
  })

  it('escalates a failing device answer to the cloud (redacted only)', async () => {
    const sent: string[] = []
    const outcome = await askHybrid(
      baseInput({
        generate: async () => ({ text: 'Probably fine.' }), // no citation → check fails
        send: async (_question, context: RedactedText) => {
          sent.push(context.text)
          expect(context.text).toContain('[NAME_1]')
          expect(context.text).not.toContain('Jane Testpatient')
          return {
            text: 'A1C for [NAME_1] was 6.7% [report.pdf, page 1].',
            prompt: 'PROMPT PREVIEW',
          }
        },
        getMaps: async () => [{ token: '[NAME_1]', type: 'NAME', value: 'Jane Testpatient' }],
      }),
    )
    expect(outcome.target).toBe('cloud')
    expect(outcome.reason).toMatch(/quality check/)
    expect(outcome.cloudPreview).toBe('PROMPT PREVIEW')
    // The cloud answer is rehydrated locally.
    expect(outcome.text).toContain('Jane Testpatient')
    expect(sent.length).toBe(1)
  })

  it('routes trend questions to the cloud with rehydration', async () => {
    const outcome = await askHybrid(
      baseInput({
        question: 'How has my A1C trended over time?',
        generate: async () => {
          throw new Error('should not be called')
        },
        send: async () => ({
          text: 'A1C for [NAME_1] rose from 5.9 to 6.7 [report.pdf, page 1].',
          prompt: 'PREVIEW',
        }),
        getMaps: async () => [{ token: '[NAME_1]', type: 'NAME', value: 'Jane Testpatient' }],
      }),
    )
    expect(outcome.target).toBe('cloud')
    expect(outcome.reason).toMatch(/trend/i)
    expect(outcome.text).toContain('Jane Testpatient')
  })

  it('offline forces on-device even for trends (limited)', async () => {
    const outcome = await askHybrid(
      baseInput({
        question: 'How has my A1C trended over time?',
        online: false,
        generate: async () => ({
          text: 'A1C is 6.7% [report.pdf, page 1] — only local data is available.',
        }),
      }),
    )
    expect(outcome.target).toBe('device')
    expect(outcome.limited).toBe(true)
    expect(outcome.reason).toMatch(/Offline/)
  })

  it('cloud disabled keeps trend questions on-device', async () => {
    const outcome = await askHybrid(
      baseInput({
        question: 'How has my A1C trended over time?',
        config: { ...ROUTER_DEFAULTS, cloudEnabled: false },
        generate: async () => ({
          text: 'A1C is 6.7% [report.pdf, page 1].',
        }),
      }),
    )
    expect(outcome.target).toBe('device')
    expect(outcome.reason).toMatch(/disabled/i)
  })
})
