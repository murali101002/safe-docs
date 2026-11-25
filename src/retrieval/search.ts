import type { LabResult } from '../labs/parseRows'
import type { Chunk } from './chunk'

/**
 * Hybrid retrieval over redacted, on-device content.
 *
 * Score = 0.7 * cosine(chunk, query) + 0.3 * keyword overlap, with lab-test
 * keywords (A1C, LDL, …) weighted double — lab reports are terse, and the
 * keyword side catches exact test-name hits the semantic model may blur.
 * Nothing here touches the network.
 */

/** Weight of the semantic (cosine) part of the score. */
export const SEMANTIC_WEIGHT = 0.7
/** Weight of the keyword part of the score. */
export const KEYWORD_WEIGHT = 0.3

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'did', 'do', 'does', 'for',
  'from', 'had', 'has', 'have', 'how', 'i', 'in', 'is', 'it', 'me', 'my',
  'of', 'on', 'or', 'show', 'so', 'than', 'that', 'the', 'their', 'them',
  'this', 'to', 'was', 'what', 'when', 'where', 'which', 'why', 'will',
  'with', 'would', 'you', 'your',
])

/**
 * Known lab-test vocabulary (aliases map a query word to the test names a
 * report may print). Keys and values are lowercase.
 */
export const LAB_ALIASES: Record<string, string[]> = {
  a1c: ['hemoglobin a1c', 'hba1c', 'a1c', 'estimated average glucose', 'eag'],
  glucose: ['glucose', 'glucose fasting', 'estimated average glucose'],
  ldl: ['ldl cholesterol', 'ldl cholesterol calc', 'ldl cholesterol (calc)', 'ldl'],
  hdl: ['hdl cholesterol', 'hdl'],
  cholesterol: ['total cholesterol', 'cholesterol', 'chol/hdl ratio'],
  triglycerides: ['triglycerides'],
  tsh: ['tsh'],
  hemoglobin: ['hemoglobin', 'hemoglobin a1c', 'hgb'],
  wbc: ['wbc', 'white blood cell count'],
  platelets: ['platelets'],
  potassium: ['potassium'],
  sodium: ['sodium'],
  creatinine: ['creatinine'],
  alt: ['alt', 'alt sgpt', 'alt (sgpt)'],
}

/** Lowercase, strip punctuation: "Hemoglobin A1c" -> "hemoglobin a1c". */
export function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/** Cosine similarity; 0 when either vector is empty or lengths differ. */
export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / Math.sqrt(normA * normB)
}

/**
 * Query keywords: meaningful words plus lab aliases expanded to every test
 * name they can refer to. Order is preserved; duplicates removed.
 */
export function keywordsFor(query: string): string[] {
  const words = normalize(query).split(' ').filter((w) => w !== '' && !STOPWORDS.has(w))
  const out: string[] = []
  for (const word of words) {
    if (out.includes(word)) continue
    out.push(word)
    for (const alias of LAB_ALIASES[word] ?? []) {
      const expanded = normalize(alias)
      if (!out.includes(expanded)) out.push(expanded)
    }
  }
  return out
}

export interface RetrievedChunk {
  chunk: Chunk
  score: number
  cosine: number
  keyword: number
}

/**
 * Rank chunks for a query. `vectors` maps chunk id -> embedding; chunks
 * without a vector still rank on keywords alone (cosine 0).
 */
export function rankChunks(
  query: string,
  chunks: Chunk[],
  vectors: ReadonlyMap<string, ArrayLike<number>>,
  queryVector: ArrayLike<number>,
  topK = 5,
): RetrievedChunk[] {
  const keywords = keywordsFor(query)
  const results: RetrievedChunk[] = chunks.map((chunk) => {
    const vector = vectors.get(chunk.id)
    const cos = vector ? cosine(queryVector, vector) : 0
    const haystack = normalize(chunk.text)
    let keywordHits = 0
    let labHits = 0
    for (const keyword of keywords) {
      if (haystack.includes(keyword)) {
        keywordHits++
        if (LAB_ALIASES[keyword] !== undefined) labHits++
      }
    }
    const keywordScore = keywords.length === 0 ? 0 : keywordHits / keywords.length
    // Exact lab vocabulary is worth extra: it is what reports are about.
    const labBonus = labHits * 0.25
    const score = SEMANTIC_WEIGHT * cos + KEYWORD_WEIGHT * keywordScore + labBonus
    return { chunk, score, cosine: cos, keyword: keywordScore }
  })
  return results
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
}

/** One structured lab-row hit for a query. */
export interface LabHit {
  result: LabResult
  docId: string
  docDate: string | null
  score: number
}

/**
 * Match a query against parsed lab rows as structured data — this is how
 * "what was my A1C" finds the actual value, not prose.
 */
export function matchLabRows(
  query: string,
  rows: Array<{ result: LabResult; docId: string; docDate: string | null }>,
  topK = 5,
): LabHit[] {
  const q = normalize(query)
  const qWords = new Set(q.split(' ').filter(Boolean))
  const hits: LabHit[] = []
  for (const row of rows) {
    const test = normalize(row.result.test)
    const testWords = new Set(test.split(' ').filter(Boolean))
    let score = 0
    // Full test-name containment ("a1c" in "hemoglobin a1c").
    if (test.includes(q) || q.includes(test)) {
      score = 1
    } else {
      for (const aliases of Object.values(LAB_ALIASES)) {
        const aliasSet = new Set(aliases.map(normalize))
        const matched = [...aliasSet].some(
          (alias) => test === alias || aliasWordsMatch(alias, testWords),
        )
        const queryUsesAlias = [...aliasSet].some((alias) => qWords.has(alias))
        if (matched && queryUsesAlias) {
          score = Math.max(score, 0.9)
        }
      }
      // Word overlap between query words and the test name.
      let overlap = 0
      for (const word of qWords) {
        if (testWords.has(word) && !STOPWORDS.has(word)) overlap++
      }
      if (overlap > 0) score = Math.max(score, Math.min(0.8, overlap * 0.4))
    }
    if (score > 0) {
      hits.push({ ...row, score })
    }
  }
  return hits.sort((a, b) => b.score - a.score || (b.result.value ?? 0) - (a.result.value ?? 0)).slice(0, topK)
}

function aliasWordsMatch(alias: string, testWords: Set<string>): boolean {
  const words = alias.split(' ').filter(Boolean)
  return words.length > 0 && words.every((w) => testWords.has(w))
}
