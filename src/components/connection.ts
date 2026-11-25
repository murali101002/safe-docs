import { useEffect, useState } from 'react'

/**
 * Connection status: navigator.onLine + events, verified by a quick
 * reachability ping so a captive-portal "online" state still degrades to
 * the offline banner.
 */

export type ConnectionStatus = 'online' | 'offline'

/** Lightweight reachability probe (no-cors: resolves on success, rejects on network failure). */
export async function pingReachable(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return false
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 4000)
    await fetch('https://firebaseinstallations.googleapis.com/v1/projects', {
      method: 'HEAD',
      mode: 'no-cors',
      signal: controller.signal,
    })
    clearTimeout(timer)
    return true
  } catch {
    return false
  }
}

/** Current connection state, re-checked on online/offline events. */
export function useConnectionStatus(): ConnectionStatus {
  const [status, setStatus] = useState<ConnectionStatus>(() =>
    typeof navigator === 'undefined' || navigator.onLine ? 'online' : 'offline',
  )

  useEffect(() => {
    let cancelled = false
    const goOnline = () => setStatus('online')
    const goOffline = () => setStatus('offline')
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)

    // Verify with a ping: navigator.onLine can be optimistic.
    void pingReachable().then((reachable) => {
      if (!cancelled) setStatus(reachable ? 'online' : 'offline')
    })
    const onOnline = () => {
      void pingReachable().then((reachable) => {
        if (!cancelled) setStatus(reachable ? 'online' : 'offline')
      })
    }
    window.addEventListener('online', onOnline)

    return () => {
      cancelled = true
      window.removeEventListener('online', goOnline)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  return status
}
