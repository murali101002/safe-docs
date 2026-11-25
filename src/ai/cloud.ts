import { requireRedacted, type RedactedText } from '../redact/brand'
import { detectRegexSpans } from '../redact/regex'
import type { GenerativeModel } from 'firebase/ai'

/**
 * THE single choke point for cloud inference (hard rule 1).
 *
 * Only approved RedactedText (produced by the redact module after user
 * review) may be passed as document context; the runtime gate refuses
 * anything else. User-typed questions are scrubbed through the layer-1
 * regexes as defense in depth, since a typed question may accidentally
 * contain personal information.
 *
 * The module loads Firebase lazily so tests (and offline use of the rest
 * of the app) never require config.
 */

let cloudModel: GenerativeModel | undefined

async function getCloudModel(): Promise<GenerativeModel> {
  cloudModel ??= await (async () => {
    const { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode } =
      await import('firebase/ai')
    const { getFirebase } = await import('../firebase')
    const { CLOUD_MODEL } = await import('./hybrid')
    const ai = getAI(getFirebase().app, { backend: new GoogleAIBackend() })
    return getGenerativeModel(ai, {
      // Cloud path: never falls back on-device (that path is for raw text).
      mode: InferenceMode.ONLY_IN_CLOUD,
      inCloudParams: { model: CLOUD_MODEL },
    })
  })()
  return cloudModel
}

/** Replace obvious PII in user-typed questions with [PII_n] tokens. */
export function scrubQuestion(question: string): string {
  const spans = detectRegexSpans(question)
  if (spans.length === 0) return question
  let out = ''
  let cursor = 0
  spans.forEach((span, i) => {
    out += question.slice(cursor, span.start) + `[PII_${i + 1}]`
    cursor = span.end
  })
  out += question.slice(cursor)
  return out
}

export interface CloudAnswer {
  text: string
  /** The exact prompt that would leave the device — for the UI preview. */
  prompt: string
}

/**
 * Send a question plus approved redacted context to the cloud model.
 * Throws unless the context carries the RedactedText brand.
 */
export async function sendToCloud(
  question: string,
  context: RedactedText,
): Promise<CloudAnswer> {
  requireRedacted(context) // runtime gate — raw text can never pass
  const scrubbed = scrubQuestion(question)
  const prompt =
    `You help patients understand their medical records. Answer from the ` +
    `redacted context only, cite [DOC, page] tokens when available, and ` +
    `refuse diagnosis. Question: ${scrubbed}\n\n` +
    `Redacted context:\n${context.text}`
  const model = await getCloudModel()
  const result = await model.generateContent(prompt)
  return { text: result.response.text(), prompt }
}
