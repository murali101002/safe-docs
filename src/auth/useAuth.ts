import { useContext } from 'react'
import { AuthContext } from './AuthProvider'

/**
 * Access the auth context provided by <AuthProvider>.
 * Throws when used outside the provider — that is always a bug.
 */
export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an <AuthProvider>.')
  }
  return context
}
