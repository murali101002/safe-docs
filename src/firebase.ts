import { initializeApp, type FirebaseApp } from 'firebase/app'
import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
  type AppCheck,
} from 'firebase/app-check'
import { getAuth, type Auth } from 'firebase/auth'
import { getFirestore, type Firestore } from 'firebase/firestore'
import {
  fetchAndActivate,
  getRemoteConfig,
  type RemoteConfig,
} from 'firebase/remote-config'

/**
 * Default values applied to Remote Config. These are used before (or instead
 * of) any values fetched from the Remote Config backend, so the app behaves
 * deterministically on first run and offline.
 */
export const REMOTE_CONFIG_DEFAULTS: Record<string, string | number | boolean> =
  {
    local_max_tokens: 3000,
  }

const env = import.meta.env

function requireEnv(key: keyof ImportMetaEnv): string {
  const value = env[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(
      `Missing environment variable ${String(key)}. ` +
        `Copy .env.example to .env and fill in your Firebase config.`,
    )
  }
  return value
}

const firebaseConfig = {
  apiKey: requireEnv('VITE_FIREBASE_API_KEY'),
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: requireEnv('VITE_FIREBASE_PROJECT_ID'),
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: requireEnv('VITE_FIREBASE_APP_ID'),
}

export interface FirebaseServices {
  app: FirebaseApp
  appCheck: AppCheck
  auth: Auth
  db: Firestore
  remoteConfig: RemoteConfig
}

let services: FirebaseServices | undefined

/**
 * Initializes (once) and returns the shared Firebase services.
 *
 * Idempotent: safe to call from any module or component.
 */
export function getFirebase(): FirebaseServices {
  if (services) return services

  const app = initializeApp(firebaseConfig)

  // In dev, allow an App Check debug token so local origins pass attestation.
  // See https://firebase.google.com/docs/app-check/web/debug
  if (env.DEV && env.VITE_APP_CHECK_DEBUG_TOKEN) {
    ;(globalThis as Record<string, unknown>).FIREBASE_APPCHECK_DEBUG_TOKEN =
      env.VITE_APP_CHECK_DEBUG_TOKEN
  }

  const appCheck = initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(
      requireEnv('VITE_APP_CHECK_RECAPTCHA_ENTERPRISE_SITE_KEY'),
    ),
    isTokenAutoRefreshEnabled: true,
  })

  const auth = getAuth(app)
  const db = getFirestore(app)

  const remoteConfig = getRemoteConfig(app)
  remoteConfig.defaultConfig = REMOTE_CONFIG_DEFAULTS
  // Best effort only: the app must keep working offline, where fetch will fail.
  void fetchAndActivate(remoteConfig).catch(() => {
    // Defaults from REMOTE_CONFIG_DEFAULTS remain in effect.
  })

  services = { app, appCheck, auth, db, remoteConfig }
  return services
}
