/**
 * Router configuration, from Firebase Remote Config with safe defaults so
 * the app behaves deterministically offline and before any fetch.
 */

export interface RouterConfig {
  /** Max context size (tokens) the on-device model handles well. */
  localMaxTokens: number
  /** Whether cloud inference may be used at all (privacy: opt-in). */
  cloudEnabled: boolean
  /** Retrieval-score threshold below which answers are flagged low-confidence. */
  minConfidence: number
}

export const ROUTER_DEFAULTS: RouterConfig = {
  localMaxTokens: 3000,
  cloudEnabled: false,
  minConfidence: 0.35,
}

/** Keys in Remote Config (defaults also ship in src/firebase.ts). */
export const REMOTE_KEYS = {
  localMaxTokens: 'local_max_tokens',
  cloudEnabled: 'cloud_enabled',
  minConfidence: 'min_confidence',
} as const

/**
 * Read the router config from Remote Config. Never throws: on failure
 * (offline, signed out, tests) the built-in defaults are used.
 */
export async function loadRouterConfig(): Promise<RouterConfig> {
  try {
    const { getValue } = await import('firebase/remote-config')
    const { getFirebase } = await import('../firebase')
    const remoteConfig = getFirebase().remoteConfig
    return {
      localMaxTokens:
        getValue(remoteConfig, REMOTE_KEYS.localMaxTokens).asNumber() ||
        ROUTER_DEFAULTS.localMaxTokens,
      cloudEnabled: getValue(remoteConfig, REMOTE_KEYS.cloudEnabled).asBoolean(),
      minConfidence:
        getValue(remoteConfig, REMOTE_KEYS.minConfidence).asNumber() ||
        ROUTER_DEFAULTS.minConfidence,
    }
  } catch {
    return { ...ROUTER_DEFAULTS }
  }
}
