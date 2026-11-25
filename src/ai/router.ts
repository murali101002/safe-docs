import type { RouterConfig } from './routerConfig'

/**
 * Hybrid routing (feature 07): decide whether a question is answered
 * on-device or in the cloud, with a human-readable reason for the
 * per-answer badge.
 *
 * Hard rules baked in: offline always means on-device (with a "limited"
 * note); cloud requires the Remote-Config opt-in (cloud_enabled). Redaction,
 * summaries, explanations and doctor questions never route through here —
 * they are on-device only by construction (feature 06).
 */

export type InferenceTarget = 'device' | 'cloud'

export interface RouteDecision {
  target: InferenceTarget
  reason: string
  /** True when on-device is a compromise (offline). */
  limited?: boolean
}

/** Rough token estimate: whitespace words are ~0.75 tokens each. */
export function estimateTokens(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length
  return Math.ceil(words / 0.75)
}

/** Trend-shaped questions ("how has my A1C changed over time?"). */
export function isTrendQuestion(question: string): boolean {
  return /\b(trends?|over\s+time|history|historical|compared?|comparing|comparison|between\b[^?]*\bdates?|across\b|progress(?:ed|ion)?|worse|better|changed?|change[d]?)\b/i.test(
    question,
  )
}

export interface RouteInput {
  /** Number of distinct documents the retrieved context spans. */
  docCount: number
  isTrend: boolean
  contextTokens: number
  offline: boolean
  onDeviceAvailable: boolean
  config: RouterConfig
}

/**
 * Pure routing decision, applied in order (offline > opt-in > device
 * availability > trend/multi-doc > context size > default on-device).
 */
export function routeQuestion(input: RouteInput): RouteDecision {
  if (input.offline) {
    return {
      target: 'device',
      reason: 'Offline — answering on-device (limited to this document set)',
      limited: true,
    }
  }
  if (!input.config.cloudEnabled) {
    return {
      target: 'device',
      reason: 'Cloud disabled — on-device only',
    }
  }
  if (!input.onDeviceAvailable) {
    return {
      target: 'cloud',
      reason: 'On-device AI unavailable in this browser — using the cloud (redacted text only)',
    }
  }
  if (input.isTrend) {
    return {
      target: 'cloud',
      reason: 'Trend question — cloud model for cross-document analysis (redacted text only)',
    }
  }
  if (input.docCount > 1) {
    return {
      target: 'cloud',
      reason: `Question spans ${input.docCount} documents — cloud model (redacted text only)`,
    }
  }
  if (input.contextTokens > input.config.localMaxTokens) {
    return {
      target: 'cloud',
      reason: `Context (~${input.contextTokens} tokens) exceeds local_max_tokens (${input.config.localMaxTokens}) — cloud model (redacted text only)`,
    }
  }
  return {
    target: 'device',
    reason: 'Single-document question within on-device limits',
  }
}
