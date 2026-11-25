import { describe, expect, it } from 'vitest'
import { chunkLines } from '../retrieval/chunk'
import {
  buildReducePrompt,
  buildSectionPrompt,
  summarizeDocument,
} from './summary'

const docId = 'report.pdf::1'

/** ~16 words per line, 24 lines -> more than one chunk for map-reduce. */
const chunks = chunkLines({
  docId,
  lines: Array.from({ length: 24 }, (_, i) => {
    const heads = [
      'Hemoglobin A1c 6.7 % 4.0-5.6 H',
      'Creatinine 1.3 mg/dL 0.6-1.2',
      'Potassium 4.2 mEq/L 3.5-5.1',
    ]
    const head = heads[i % 3]
    return `${head} filler text for chunking section ${i} of the synthetic report`
  }),
})

describe('buildSectionPrompt / buildReducePrompt', () => {
  it('labels sections with doc + page and keeps safety rules', () => {
    const section = buildSectionPrompt({ chunk: chunks[0], docId })
    expect(section).toContain('[SOURCE: report.pdf, page 1]')
    expect(section).toContain('NEVER diagnose')
    expect(section).toContain('2-3 plain-language sentences')

    const reduce = buildReducePrompt({ docId, partials: ['A1c is high.', 'Kidney marker fine.'] })
    expect(reduce).toContain('[1] A1c is high.')
    expect(reduce).toContain('4-7 sentences')
    expect(reduce).toContain('review the report with their clinician')
  })
})

describe('summarizeDocument (map-reduce with progress)', () => {
  it('maps every chunk, reports progress, then reduces', async () => {
    const progress: Array<{ done: number; total: number }> = []
    const mapPrompts: string[] = []
    let reducePrompt = ''
    const { summary, partials } = await summarizeDocument(
      { chunks, docId },
      {
        onProgress: (p) => progress.push({ ...p }),
        generate: async (prompt) => {
          if (prompt.includes('2-3 plain-language sentences')) {
            mapPrompts.push(prompt)
            return { text: ` Section summary ${mapPrompts.length}. ` }
          }
          reducePrompt = prompt
          return { text: 'The report shows an elevated A1C and normal kidney markers.' }
        },
      },
    )
    expect(mapPrompts).toHaveLength(chunks.length)
    expect(progress).toEqual(
      Array.from({ length: chunks.length }, (_, i) => ({ done: i + 1, total: chunks.length })),
    )
    expect(reducePrompt).toContain('[1] Section summary 1.')
    expect(reducePrompt).toContain('[2] Section summary 2.')
    expect(partials).toEqual([
      'Section summary 1.',
      'Section summary 2.',
      'Section summary 3.',
    ])
    expect(summary).toBe('The report shows an elevated A1C and normal kidney markers.')
  })

  it('skips failed chunks but still reduces the survivors', async () => {
    let mapCalls = 0
    const { summary, partials } = await summarizeDocument(
      { chunks, docId },
      {
        generate: async (prompt) => {
          if (prompt.includes('2-3 plain-language sentences')) {
            mapCalls++
            if (mapCalls === 1) throw new Error('on-device hiccup')
            return { text: 'Kidney markers look fine.' }
          }
          return { text: 'Partial summary only.' }
        },
      },
    )
    expect(partials).toEqual(
      Array.from({ length: chunks.length - 1 }, () => 'Kidney markers look fine.'),
    )
    expect(summary).toBe('Partial summary only.')
  })

  it('throws when no section could be summarized', async () => {
    await expect(
      summarizeDocument(
        { chunks, docId },
        {
          generate: async (prompt) => {
            if (prompt.includes('2-3 plain-language sentences')) {
              throw new Error('always fails')
            }
            return { text: 'unused' }
          },
        },
      ),
    ).rejects.toThrow('no sections could be summarized')
  })

  it('treats empty section output as a failure too', async () => {
    await expect(
      summarizeDocument(
        { chunks, docId },
        {
          generate: async (prompt) => {
            if (prompt.includes('2-3 plain-language sentences')) {
              return { text: '   ' }
            }
            return { text: 'unused' }
          },
        },
      ),
    ).rejects.toThrow('no sections could be summarized')
  })
})
