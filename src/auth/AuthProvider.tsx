import { createContext } from 'react'
import { FirebaseError } from 'firebase/app'
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  type Auth,
  type User,
} from 'firebase/auth'
import {
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { getFirebase } from '../firebase'

/** Everything the UI needs to render and drive email/password auth. */
export interface AuthContextValue {
  /** Signed-in user, or null when signed out. */
  user: User | null
  /** True until the initial auth state has been resolved from the SDK. */
  loading: boolean
  signUp: (email: string, password: string) => Promise<void>
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  resetPassword: (email: string) => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | undefined>(
  undefined,
)

/**
 * Maps Firebase error codes to safe, actionable messages. Firebase's own
 * messages leak internals ("Invalid login credentials" is fine, but some
 * codes read like stack traces), and the raw codes are not user-friendly.
 */
export function friendlyAuthError(err: unknown): string {
  if (err instanceof FirebaseError) {
    switch (err.code) {
      case 'auth/invalid-credential':
      case 'auth/wrong-password':
      case 'auth/user-not-found':
        return 'Incorrect email or password.'
      case 'auth/email-already-in-use':
        return 'An account with this email already exists.'
      case 'auth/weak-password':
        return 'Password should be at least 6 characters.'
      case 'auth/invalid-email':
        return 'Please enter a valid email address.'
      case 'auth/too-many-requests':
        return 'Too many attempts. Try again in a little while.'
    }
    return err.message
  }
  return err instanceof Error ? err.message : 'Something went wrong.'
}

function getAuth(): Auth {
  return getFirebase().auth
}

/**
 * Provides email/password auth state and actions to the whole app.
 * Mount once, above any component that calls useAuth().
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // onAuthStateChanged fires immediately with the current user (null when
    // signed out) and again on every sign-in/out, so no manual refresh needed.
    return onAuthStateChanged(getAuth(), (current) => {
      setUser(current)
      setLoading(false)
    })
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      signUp: async (email, password) => {
        await createUserWithEmailAndPassword(getAuth(), email, password)
      },
      signIn: async (email, password) => {
        await signInWithEmailAndPassword(getAuth(), email, password)
      },
      signOut: async () => {
        await firebaseSignOut(getAuth())
      },
      resetPassword: async (email) => {
        await sendPasswordResetEmail(getAuth(), email)
      },
    }),
    [user, loading],
  )

  return <AuthContext value={value}>{children}</AuthContext>
}
