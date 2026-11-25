import type { RedactedText } from '../redact/brand'
import {
  assembleCloudContext,
  rehydrate,
  type CloudContextDoc,
} from '../redact/pipeline'
import { getTokenMap } from '../redact/tokenStore'
import type { TokenMap } from '../redact/types'
import { chunkLines, type Chunk } from '../retrieval/chunk'
import { buildIndex, embedQuery } from '../retrieval/indexer'
import type { Embedder } from '../retrieval/embedder'
import {
  matchLabRows,
  rankChunks,
  type LabHit,
  type RetrievedChunk,
} from '../retrieval/search'
import { answerQuestion, docLabelOf } from '../intelligence/qa'
import type { OnDeviceGenerate } from '../intelligence/options'
import { estimateTokens, isTrendQuestion, routeQuestion } from './router'
import type { RouterConfig } from './routerConfig'

/**
 * Hybrid ask orchestrator (feature 07): retrieve over all approved docs
 * on-device, route device vs cloud, answer, run the quality gate, escalate
 * a failing device answer to the cloud when allowed, and rehydrate token
 * placeholders back to real values locally.
 */

export interface AskScopeDoc {
  docId: string
  docDate: string | null
  /** Approved redacted text (tokens, no PII). */
  redactedText: string
  labResults: import('../labs/parseRows').LabResult[]
}

export interface AskOutcome {
  text: string
  target: 'device' | 'cloud'
  reason: string
  limited?: boolean
  lowConfidence?: boolean
  problem?: 'empty' | 'no citation'
  sources: RetrievedChunk[]
  labHits: LabHit[]
  /** The exact prompt that left the device (cloud only). */
  cloudPreview?: string
}

export interface AskHybridInput {
  question: string
  /** All approved documents in scope (local registry). */
  scope: AskScopeDoc[]
  config: RouterConfig
  online: boolean
  onDeviceAvailable: boolean
  embedder: Embedder
  /** Inject the on-device generator for tests. */
  generate?: OnDeviceGenerate
  /** Inject the cloud sender for tests. */
  send?: (question: string, context: RedactedText) => Promise<{ text: string; prompt: string }>
  /** Inject the token-map loader for tests. */
  getMaps?: (docId: string) => Promise<TokenMap | null>
}

/** Per-chunk source header used in both prompt styles. */
function chunkSection(chunk: Chunk): string {
  return `[SOURCE: ${docLabelOf(chunk.docId)}, page ${chunk.pages.join(', ')}]\n${chunk.text}`
}

/** Load the in-scope chunks, vectors, and lab rows across all docs. */
async function gatherScope(
  scope: AskScopeDoc[],
  embedder: Embedder,
): Promise<{
  chunks: Chunk[]
  vectors: Map<string, Float32Array>
  labRows: Array<{ result: AskScopeDoc['labResults'][number]; docId: string; docDate: string | null }>
}> {
  const chunks: Chunk[] = []
  const vectors = new Map<string, Float32Array>()
  const labRows: Array<{ result: AskScopeDoc['labResults'][number]; docId: string; docDate: string | null }> = []
  for (const doc of scope) {
    const docChunks = chunkLines({ docId: doc.docId, lines: doc.redactedText.split('\n') })
    chunks.push(...docChunks)
    try {
      const result = await buildIndex(docChunks, embedder)
      for (const [id, vector] of result.vectors) vectors.set(id, vector)
    } catch {
      // No vectors for this doc (e.g. model download needed) — keyword
      // ranking still works.
    }
    for (const result of doc.labResults) {
      labRows.push({ result, docId: doc.docId, docDate: doc.docDate })
    }
  }
  return { chunks, vectors, labRows }
}

/**
 * Answer a question, routing on-device vs cloud per the router, with
 * quality-gate escalation and local rehydration of token placeholders.
 */
export async function askHybrid(input: AskHybridInput): Promise<AskOutcome> {
  const { chunks, vectors, labRows } = await gatherScope(input.scope, input.embedder)

  let queryVector: Float32Array | undefined
  try {
    queryVector = await embedQuery(input.question, input.embedder)
  } catch {
    // Keyword-only ranking still works.
  }
  const sources = rankChunks(
    input.question,
    chunks,
    vectors,
    queryVector ?? new Float32Array(0),
    6,
  )
  const labHits = matchLabRows(input.question, labRows, 5)

  const contextTokens = estimateTokens(sources.map((s) => s.chunk.text).join('\n\n'))
  const docCount = new Set(sources.map((s) => s.chunk.docId)).size
  const decision = routeQuestion({
    docCount,
    isTrend: isTrendQuestion(input.question),
    contextTokens,
    offline: !input.online,
    onDeviceAvailable: input.onDeviceAvailable,
    config: input.config,
  })
  const topScore = sources[0]?.score
  const lowConfidence =
    topScore !== undefined && topScore < input.config.minConfidence

  const cloudAllowed = input.config.cloudEnabled && input.online

  if (decision.target === 'device') {
    const answer = await answerQuestion(
      { question: input.question, chunks: sources.map((s) => s.chunk), labHits },
      { generate: input.generate },
    )
    const failed = answer.problem !== undefined
    if (failed && cloudAllowed) {
      // Quality-gate escalation: retry in the cloud (redacted text only).
      return askInCloud(input, sources, labHits, decision, lowConfidence, true)
    }
    return finalizeDeviceAnswer(answer.text, answer.problem, sources, labHits, decision, lowConfidence, input)
  }

  return askInCloud(input, sources, labHits, decision, lowConfidence, false)
}

/** Rehydrate a device answer against the top source doc's token map. */
async function finalizeDeviceAnswer(
  text: string,
  problem: 'empty' | 'no citation' | undefined,
  sources: RetrievedChunk[],
  labHits: LabHit[],
  decision: ReturnType<typeof routeQuestion>,
  lowConfidence: boolean,
  input: AskHybridInput,
): Promise<AskOutcome> {
  let hydrated = text
  const topDoc = sources[0]?.chunk.docId
  if (topDoc !== undefined && text.includes('[')) {
    const loadMap = input.getMaps ?? getTokenMap
    const map = await loadMap(topDoc)
    if (map !== null) hydrated = rehydrate(text, map)
  }
  return {
    text: hydrated,
    target: 'device',
    reason: decision.reason,
    limited: decision.limited,
    lowConfidence,
    problem,
    sources,
    labHits,
  }
}

/** Cloud path: assemble approved context (token-renumbered) and send. */
async function askInCloud(
  input: AskHybridInput,
  sources: RetrievedChunk[],
  labHits: LabHit[],
  decision: ReturnType<typeof routeQuestion>,
  lowConfidence: boolean,
  escalated: boolean,
): Promise<AskOutcome> {
  // In-scope chunks per doc: the ranked sources, or (when nothing matched
  // the query) the first chunks of each doc so the model still has context.
  const byDoc = new Map<string, Chunk[]>()
  if (sources.length > 0) {
    for (const source of sources) {
      const list = byDoc.get(source.chunk.docId) ?? []
      list.push(source.chunk)
      byDoc.set(source.chunk.docId, list)
    }
  } else {
    // Nothing matched the query — give the model the head of each document.
    for (const doc of input.scope) {
      const docChunks = chunkLines({ docId: doc.docId, lines: doc.redactedText.split('\n') })
      byDoc.set(doc.docId, docChunks.slice(0, 4))
    }
  }

  const loadMap = input.getMaps ?? getTokenMap
  const contextDocs: CloudContextDoc[] = []
  for (const [docId, docChunks] of byDoc) {
    const map = await loadMap(docId)
    contextDocs.push({
      docId,
      text: docChunks.map(chunkSection).join('\n\n'),
      tokenMap: map ?? [],
    })
  }

  const assembled = assembleCloudContext(contextDocs)
  const send = input.send ?? (await import('./cloud')).sendToCloud
  const { text, prompt } = await send(input.question, assembled.redacted)

  return {
    text: rehydrate(text, assembled.tokenMap),
    target: 'cloud',
    reason: escalated
      ? 'Device answer failed the quality check — retrying in the cloud (redacted text only)'
      : decision.reason,
    lowConfidence,
    sources,
    labHits,
    cloudPreview: prompt,
  }
}
