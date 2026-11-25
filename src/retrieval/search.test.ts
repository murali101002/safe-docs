import { describe, expect, it } from 'vitest'
import { chunkLines } from './chunk'
import {
  cosine,
  keywordsFor,
  matchLabRows,
  rankChunks,
  type LabHit,
} from './search'
import type { LabResult } from '../labs/parseRows'

/** Hand-built 4-dim vectors for deterministic ranking tests. */
function vec(...xs: number[]): Float32Array {
  return Float32Array.from(xs)
}

function chunkOf(id: string, text: string, docId = 'doc-1') {
  const [only] = chunkLines({ docId, lines: text.split('\n') })
  return { ...only, id }
}

describe('cosine', () => {
  it('is 1 for identical vectors and 0 for orthogonal ones', () => {
    expect(cosine(vec(1, 0), vec(1, 0))).toBeCloseTo(1)
    expect(cosine(vec(1, 0), vec(0, 1))).toBeCloseTo(0)
    expect(cosine(vec(1, 0), vec(-1, 0))).toBeCloseTo(-1)
  })

  it('is 0 for mismatched or empty vectors', () => {
    expect(cosine(vec(1, 0), vec(1, 0, 0))).toBe(0)
    expect(cosine(vec(0, 0), vec(1, 0))).toBe(0)
  })
})

describe('keywordsFor', () => {
  it('drops stopwords and expands lab aliases', () => {
    const keywords = keywordsFor('What was my A1C trend?')
    expect(keywords).toContain('a1c')
    expect(keywords).toContain('hemoglobin a1c')
    expect(keywords).not.toContain('what')
    expect(keywords).not.toContain('my')
  })
})

describe('rankChunks (hybrid cosine + keyword)', () => {
  const chunks = [
    chunkOf('c0', 'Patient consent and billing paperwork. Nothing about labs here.'),
    chunkOf('c1', 'Hemoglobin A1c 6.7 % 4.0-5.6 H. Estimated average glucose 146 mg/dL.'),
    chunkOf('c2', 'White blood cell count and platelets from the CBC differential.'),
  ]

  it('ranks the semantically closest chunk first', () => {
    // Query vector matches c1's vector direction.
    const vectors = new Map([
      ['c0', vec(1, 0, 0, 0)],
      ['c1', vec(0, 1, 0, 0)],
      ['c2', vec(0, 0, 1, 0)],
    ])
    const ranked = rankChunks('blood sugar control', chunks, vectors, vec(0, 1, 0, 0))
    expect(ranked[0].chunk.id).toBe('c1')
    expect(ranked[0].cosine).toBeGreaterThan(ranked[1]?.cosine ?? 0)
  })

  it('keyword overlap lifts a chunk above cosine alone', () => {
    // c3 has a weaker cosine but contains exact lab vocabulary.
    const chunks4 = [
      chunkOf('c3', 'Discusses diet and exercise plan for the patient.'),
      chunkOf('c4', 'Hemoglobin A1c 6.7 % 4.0-5.6 H, LDL Cholesterol 110 mg/dL <100.'),
    ]
    const vectors = new Map([
      ['c3', vec(0.9, 0.1, 0, 0)],
      ['c4', vec(0.6, 0.8, 0, 0)],
    ])
    const query = vec(1, 0, 0, 0)
    const ranked = rankChunks('What was my A1C and LDL?', chunks4, vectors, query)
    // c4 must outrank c3 despite the lower cosine, because of keywords+lab bonus.
    expect(ranked[0].chunk.id).toBe('c4')
    expect(ranked[0].keyword).toBeGreaterThan(ranked[1].keyword)
  })

  it('returns [] when nothing matches at all', () => {
    const vectors = new Map([
      ['c0', vec(1, 0, 0, 0)],
    ])
    const ranked = rankChunks('kidney function', [chunks[0]], vectors, vec(0, 1, 0, 0))
    expect(ranked).toEqual([])
  })

  it('ranks keyword-only chunks (no vector) above zero', () => {
    const ranked = rankChunks('A1C', [chunks[1]], new Map(), vec(0, 0, 0, 0))
    expect(ranked.length).toBe(1)
    expect(ranked[0].cosine).toBe(0)
    expect(ranked[0].score).toBeGreaterThan(0)
  })
})

describe('matchLabRows (structured lab queries)', () => {
  const result = (test: string, value: number | null, flag: LabResult['flag'] = null): LabResult => ({
    test,
    value,
    unit: 'mg/dL',
    refLow: null,
    refHigh: null,
    refText: null,
    flag,
    page: 1,
  })

  const rows = [
    { result: result('Hemoglobin A1c', 6.7, 'H'), docId: 'doc-1', docDate: '2026-01-15' },
    { result: result('LDL Cholesterol (calc)', 110, 'H'), docId: 'doc-1', docDate: '2026-01-15' },
    { result: result('Potassium', 4.2), docId: 'doc-2', docDate: '2026-03-15' },
  ]

  it('matches a1c to Hemoglobin A1c via aliases', () => {
    const hits: LabHit[] = matchLabRows('what was my a1c', rows)
    expect(hits).toHaveLength(1)
    expect(hits[0].result.test).toBe('Hemoglobin A1c')
    expect(hits[0].result.value).toBe(6.7)
    expect(hits[0].docDate).toBe('2026-01-15')
  })

  it('matches ldl to the calculated LDL row', () => {
    const hits = matchLabRows('is my LDL high?', rows)
    expect(hits.map((h) => h.result.test)).toEqual(['LDL Cholesterol (calc)'])
  })

  it('matches by direct name containment', () => {
    const hits = matchLabRows('potassium level', rows)
    expect(hits.map((h) => h.result.test)).toEqual(['Potassium'])
  })

  it('returns [] when no lab matches', () => {
    expect(matchLabRows('influenza vaccine date', rows)).toEqual([])
  })
})
