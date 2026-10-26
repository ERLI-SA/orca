// Show the notice only for unresolved pre-telemetry consent; new users receive install-time disclosure. No events transmit until existing users resolve it (telemetry-plan.md §First-launch experience).
// Hide optimistically while saved settings round-trip to prevent notice flashes; rebase on main’s saved consent after rejection.

import { useState } from 'react'
import { useAppStore } from '../store'
import { FirstLaunchBanner } from './FirstLaunchBanner'
import { isCapabilityDisabled } from '../../../shared/disabled-capabilities'

export function TelemetryFirstLaunchSurface(): React.JSX.Element | null {
  const settings = useAppStore((s) => s.settings)
  // Rebase to main's saved consent after the IPC write, including when a mutation was rejected.
  const fetchSettings = useAppStore((s) => s.fetchSettings)
  const [dismissedThisSession, setDismissedThisSession] = useState(false)

  // Why: a build with telemetry compiled out has nothing to opt into, so the
  // notice would ask the user to resolve a choice that cannot change anything.
  if (isCapabilityDisabled('privacy')) {
    return null
  }
  if (!settings || dismissedThisSession) {
    return null
  }

  const telemetry = settings.telemetry
  if (!telemetry) {
    // Missing consent data cannot safely identify the cohort.
    return null
  }

  const isExistingUserAwaitingBanner =
    telemetry.existedBeforeTelemetryRelease === true && telemetry.optedIn === null
  if (!isExistingUserAwaitingBanner) {
    return null
  }

  return (
    <FirstLaunchBanner
      fetchSettings={fetchSettings}
      onResolve={() => setDismissedThisSession(true)}
    />
  )
}
