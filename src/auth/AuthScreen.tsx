import { useState, type FormEvent } from 'react'
import { friendlyAuthError } from './AuthProvider'
import { useAuth } from './useAuth'

/**
 * Minimal email/password gate shown when the app is signed out.
 * Handles sign in, sign up, and password reset with a shared email field.
 */
export function AuthScreen() {
  const { signIn, signUp, resetPassword } = useAuth()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setNotice(null)
    setBusy(true)
    try {
      if (mode === 'signup') {
        await signUp(email, password)
        setNotice('Account created — you are signed in.')
      } else {
        await signIn(email, password)
      }
    } catch (err) {
      setError(friendlyAuthError(err))
    } finally {
      setBusy(false)
    }
  }

  async function onResetPassword() {
    setError(null)
    setNotice(null)
    if (!email) {
      setError('Enter your email above first, then click reset.')
      return
    }
    setBusy(true)
    try {
      await resetPassword(email)
      setNotice(`Password reset email sent to ${email}.`)
    } catch (err) {
      setError(friendlyAuthError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main>
      <h1>SafeDocs</h1>
      <form className="auth" onSubmit={onSubmit}>
        <h2>{mode === 'signin' ? 'Sign in' : 'Create account'}</h2>
        <label>
          <p>Email</p>
          <input
            type="email"
            value={email}
            autoComplete="email"
            required
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          <p>Password</p>
          <input
            type="password"
            value={password}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            minLength={6}
            required
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button type="submit" disabled={busy}>
          {busy ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Sign up'}
        </button>
        <p>
          {mode === 'signin' ? (
            <>
              No account?{' '}
              <button type="button" onClick={() => setMode('signup')}>
                Sign up
              </button>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <button type="button" onClick={() => setMode('signin')}>
                Sign in
              </button>
            </>
          )}
          {' · '}
          <button type="button" onClick={onResetPassword} disabled={busy}>
            Reset password
          </button>
        </p>
        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
      </form>
    </main>
  )
}
