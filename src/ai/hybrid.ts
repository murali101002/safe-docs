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

/**
 * Cloud fallback model.
 *
 * Verified against https://firebase.google.com/docs/ai-logic/models (Nov 2026):
 * gemini-2.5-flash is deprecated and stops routing on Dec 1, 2026; the skill
 * docs require a current Gemini 3+ model. gemini-3.8-flash is stable, fast,
 * and needs no billing on the Gemini Developer API free tier.
 */
export const CLOUD_MODEL = 'gemini-3.8-flash'

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

let onDeviceModel: GenerativeModel | undefined

/** An image to analyze on-device (base64, no data: prefix). */
export interface OnDeviceImage {
  base64: string
  mimeType: string
}

/**
 * Generate with the on-device model ONLY.
 *
 * `InferenceMode.ONLY_ON_DEVICE` means the SDK will never fall back to a
 * cloud model — if Chrome's Gemini Nano is unavailable the call throws.
 * This is the mandatory path for anything that may contain PII (raw
 * document text, IMAGES) before redaction exists.
 */
export async function generateOnDevice(
  prompt: string,
  image?: OnDeviceImage,
): Promise<{ text: string }> {
  aiInstance ??= getAI(getFirebase().app, { backend: new GoogleAIBackend() })
  onDeviceModel ??= getGenerativeModel(aiInstance, {
    mode: InferenceMode.ONLY_ON_DEVICE,
    // No cloud params on purpose: nothing here may ever reach the cloud.
  })
  // Multimodal on-device: text + inline image (Chrome's on-device model
  // reports cloud inference only if the SDK misroutes — refuse that).
  const request = image
    ? [
        prompt,
        {
          type: 'inlineData' as const,
          inlineData: { mimeType: image.mimeType, data: image.base64 },
        },
      ]
    : prompt
  const result = await onDeviceModel.generateContent(request)
  const { response } = result
  // Defense in depth: refuse a response that reports cloud inference.
  if (response.inferenceSource === InferenceSource.IN_CLOUD) {
    throw new Error('On-device guard violated: response ran in the cloud')
  }
  return { text: response.text() }
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
