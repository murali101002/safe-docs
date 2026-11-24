import { useEffect, useState } from 'react'

export type ConnectionStatus = 'online' | 'offline'

interface BannerState {
  status: ConnectionStatus
}

/** Current browser connection state via navigator.onLine + online/offline events. */
function useConnectionStatus(): ConnectionStatus {
  const [status, setStatus] = useState<ConnectionStatus>(() =>
    navigator.onLine ? 'online' : 'offline',
  )

  useEffect(() => {
    const goOnline = () => setStatus('online')
    const goOffline = () => setStatus('offline')
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  return status
}

const STYLES: Record<ConnectionStatus, React.CSSProperties> = {
  online: { background: '#0a7d33', color: '#ffffff' }, // green
  offline: { background: '#b77900', color: '#ffffff' }, // yellow
}

const MESSAGES: Record<ConnectionStatus, string> = {
  online: 'Online: cloud mode will send redacted text only',
  offline: 'Offline: answers limited to on-device',
}

/**
 * Sticky privacy status bar. There are three important states for patients:
 *
 *  - green  "On-device: nothing leaves this computer"  (device inference)
 *  - blue   "Cloud: sending redacted text only"        (cloud inference)
 *  - yellow "Offline: answers limited to on-device"    (no network)
 *
 * The online/offline variants below come from navigator.onLine; the
 * on-device vs cloud variant is driven by the `inference` prop that App
 * sets from HybridResult.ranOn.
 */
export function StatusBanner({
  inference,
}: {
  inference?: 'device' | 'cloud'
}) {
  const { status } = { status: useConnectionStatus() } satisfies BannerState

  if (status === 'offline') {
    return (
      <div role="status" style={STYLES.offline} className="status-banner">
        🟡 {MESSAGES.offline}
      </div>
    )
  }

  if (inference === 'device') {
    return (
      <div
        role="status"
        style={{ background: '#0a7d33', color: '#ffffff' }}
        className="status-banner"
      >
        🟢 On-device: nothing leaves this computer
      </div>
    )
  }

  return (
    <div
      role="status"
      style={{ background: '#0b57d0', color: '#ffffff' }}
      className="status-banner"
    >
      🔵 Cloud: sending redacted text only
    </div>
  )
}
