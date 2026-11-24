/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Firebase web app config (Project settings > SDK setup). */
  readonly VITE_FIREBASE_API_KEY: string
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string
  readonly VITE_FIREBASE_PROJECT_ID: string
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string
  readonly VITE_FIREBASE_APP_ID: string
  /** App Check reCAPTCHA Enterprise site key. */
  readonly VITE_APP_CHECK_RECAPTCHA_ENTERPRISE_SITE_KEY: string
  /** App Check debug token (dev only). */
  readonly VITE_APP_CHECK_DEBUG_TOKEN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
