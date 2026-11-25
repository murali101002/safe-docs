/**
 * Shared plumbing for on-device intelligence features (feature 06).
 *
 * Everything here runs on Chrome's on-device Gemini Nano ONLY
 * (generateOnDevice → InferenceMode.ONLY_ON_DEVICE) so answers work fully
 * in airplane mode and raw/redacted text never reaches the cloud from
 * these paths. The generator is injectable for tests — the real model
 * never runs in Node/CI.
 */

export type OnDeviceGenerate = (prompt: string) => Promise<{ text: string }>

export interface IntelligenceOptions {
  /** Injectable generator for tests; defaults to the on-device model. */
  generate?: OnDeviceGenerate
}

/**
 * Default generator: the on-device model only, imported lazily so modules
 * stay testable without Firebase config and without a browser.
 */
export function defaultGenerate(): OnDeviceGenerate {
  return async (prompt: string) => {
    const { generateOnDevice } = await import('../ai/hybrid')
    return generateOnDevice(prompt)
  }
}

export function resolveGenerate(options: IntelligenceOptions = {}): OnDeviceGenerate {
  return options.generate ?? defaultGenerate()
}

/** Shared rules for every intelligence prompt. */
export const SAFETY_RULES = [
  'You are SafeDocs, a plain-language explainer for medical records.',
  'Rules:',
  '- Informational only: NEVER diagnose, never recommend treatment or medication changes.',
  '- If the question asks for a diagnosis, say you cannot diagnose and suggest discussing it with the clinician.',
  '- Only use the provided document context; if it does not contain the answer, say so plainly.',
  '- Answer in simple, warm language a patient can understand.',
].join('\n')
