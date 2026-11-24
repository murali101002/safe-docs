import { getAI, getGenerativeModel, GoogleAIBackend } from 'firebase/ai'
import { InferenceMode, InferenceSource } from 'firebase/ai'
import type { AI, GenerativeModel } from 'firebase/ai'
import { getFirebase } from '../firebase'

/**
 * Hybrid AI via Firebase AI Logic.
 *
 * The model runs hybrid inference with `InferenceMode.PREFER_ON_DEVICE`:
 * Chrome's built-in Gemini Nano (Prompt API) is used when it can serve the
 * request, and the SDK transparently falls back to the cloud Gemini model
 * otherwise. Every result reports which path actually ran, so the UI can
 * tell users whether their data stayed on this computer.
 *
 * NOTE: `InferenceMode` / `InferenceSource` are const objects (not TS enums)
 * in firebase@13 — see node_modules/@firebase/ai/dist/ai.d.ts.
 */

/** Cloud fallback model. Kept here so it is easy to bump for the demo. */
export const CLOUD_MODEL = 'gemini-2.5-flash'

/** Result of one generation call, tagged with where it actually ran. */
export interface HybridResult {
  text: string
  /** 'device' = Chrome's on-device model, 'cloud' = Gemini in the cloud. */
  ranOn: 'device' | 'cloud'
}

let aiInstance: AI | undefined
let hybridModel: GenerativeModel | undefined

function getModel(): GenerativeModel {
  if (hybridModel) return hybridModel
  aiInstance ??= getAI(getFirebase().app, { backend: new GoogleAIBackend() })
  hybridModel = getGenerativeModel(aiInstance, {
    mode: InferenceMode.PREFER_ON_DEVICE,
    inCloudParams: { model: CLOUD_MODEL },
  })
  return hybridModel
}

/** Generate an answer, preferring on-device inference and falling back to cloud. */
export async function generate(prompt: string): Promise<HybridResult> {
  const result = await getModel().generateContent(prompt)
  const { response } = result
  return {
    text: response.text(),
    ranOn: response.inferenceSource === InferenceSource.ON_DEVICE
      ? 'device'
      : 'cloud',
  }
}

/**
 * Whether Chrome's on-device model is usable right now, mirroring the check
 * the SDK's ChromeAdapter performs (`window.LanguageModel.availability()`,
 * the Chrome Prompt API). 'downloadable'/'downloading' count as available
 * only for the SDK's ONLY_ON_DEVICE path; for PREFER_ON_DEVICE the SDK
 * needs the model already 'available', so we report that.
 */
export async function isOnDeviceAvailable(): Promise<boolean> {
  if (typeof window === 'undefined') return false
  const provider = (window as unknown as Record<string, unknown>)
    .LanguageModel as { availability?: (o?: unknown) => Promise<string> } | undefined
  if (!provider?.availability) return false
  const availability = await provider.availability()
  return availability === 'available'
}
