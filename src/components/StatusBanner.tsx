import { useConnectionStatus } from './connection'

/**
 * Sticky privacy status bar (feature 07 states):
 *
 * - yellow "Offline: answers limited to on-device"
 * - orange "On-device AI unavailable" (browser lacks Chrome's Nano)
 * - blue  "Cloud: sending redacted text only" + "see what's sent" preview
 * - green "On-device: nothing leaves this computer" (default/last device answer)
 *
 * The per-answer badge with the ROUTING REASON is shown with the answer in
 * the intelligence panel; the banner reflects the latest state.
 */
export interface StatusBannerProps {
  /** Where the last answer ran (device = green, cloud = blue). */
  inference?: 'device' | 'cloud'
  /** Whether Chrome's on-device model is usable (null = not yet checked). */
  onDeviceAvailable: boolean | null
  /** The exact prompt that left the device for the last cloud answer. */
  cloudPreview?: string
}

const STYLES: Record<string, React.CSSProperties> = {
  offline: { background: '#b77900', color: '#ffffff' },
  unavailable: { background: '#9a4b00', color: '#ffffff' },
  cloud: { background: '#0b57d0', color: '#ffffff' },
  device: { background: '#0a7d33', color: '#ffffff' },
}

export function StatusBanner({
  inference,
  onDeviceAvailable,
  cloudPreview,
}: StatusBannerProps) {
  const status = useConnectionStatus()

  if (status === 'offline') {
    return (
      <div role="status" style={STYLES.offline} className="status-banner">
        🟡 Offline: answers limited to on-device
      </div>
    )
  }

  if (onDeviceAvailable === false) {
    return (
      <div role="status" style={STYLES.unavailable} className="status-banner">
        ⚠️ On-device AI unavailable — answers need the cloud (redacted text only) or stay offline
      </div>
    )
  }

  if (inference === 'cloud') {
    return (
      <div role="status" style={STYLES.cloud} className="status-banner">
        🔵 Cloud: sending redacted text only
        {cloudPreview && (
          <details className="cloud-preview">
            <summary>see what&apos;s sent</summary>
            <pre>{cloudPreview}</pre>
          </details>
        )}
      </div>
    )
  }

  return (
    <div role="status" style={STYLES.device} className="status-banner">
      🟢 On-device: nothing leaves this computer
    </div>
  )
}
