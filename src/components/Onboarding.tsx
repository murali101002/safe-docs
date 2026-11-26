import { useState } from 'react'

/**
 * Onboarding card (feature 09): explains the on-device vs cloud split in
 * plain language. Dismissed state persists in localStorage.
 */

const DISMISSED_KEY = 'safedocs_onboarding_done'

export function Onboarding() {
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(DISMISSED_KEY) === 'true',
  )
  if (dismissed) return null

  function dismiss(): void {
    localStorage.setItem(DISMISSED_KEY, 'true')
    setDismissed(true)
  }

  return (
    <section aria-labelledby="onboarding-heading" className="onboarding">
      <h2 id="onboarding-heading">How SafeDocs protects you</h2>
      <ol>
        <li>
          <strong>Your documents never leave this computer unredacted.</strong>{' '}
          PDFs and photos are read locally; anything that might contain your
          personal details is redacted on-device (Chrome&apos;s built-in AI).
        </li>
        <li>
          <strong>You review every redaction.</strong> Nothing is stored or
          shared until you approve — names, dates of birth, IDs and addresses
          become tokens like <code>[NAME_1]</code>, and the key to undo them
          stays in this browser.
        </li>
        <li>
          <strong>Answers default to on-device.</strong> Questions are
          answered by the AI on this computer. Only when you opt in and a
          question truly needs more power (trends across visits, several
          documents) does the cloud see anything — and it only ever sees the
          redacted tokens, never your details.
        </li>
      </ol>
      <p>
        <button type="button" onClick={dismiss}>
          Got it
        </button>
      </p>
    </section>
  )
}

/** Global disclaimer footer: present on every screen. */
export function DisclaimerFooter() {
  return (
    <footer className="site-footer">
      <p>
        SafeDocs is informational only and <strong>not medical advice</strong>
        {' '}— it never diagnoses. Always discuss your results with your
        clinician. If this is an emergency, contact your local emergency
        number.
      </p>
    </footer>
  )
}

/** Empty state shown before any document is loaded. */
export function EmptyState() {
  return (
    <div role="status" className="empty-state">
      <p>
        <strong>No document open yet.</strong> Choose a medical record PDF or
        a photo of one above — everything is read on this computer.
      </p>
    </div>
  )
}
