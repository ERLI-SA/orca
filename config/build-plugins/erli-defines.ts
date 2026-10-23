// ERLI fork build constants, kept out of electron.vite.config.ts so upstream's file
// stays under its line budget and the fork's surface stays in one reviewable place.
import {
  DISABLEABLE_CAPABILITIES,
  isDisableableCapability
} from '../../src/shared/disabled-capabilities'

// Why re-exported: upstream's config sits exactly at max-lines, so the fork's import
// takes the place of this one instead of adding a line.
export { resolveBuildSourceCommit } from '../scripts/build-source-commit.mjs'

// Why compile-time and not an env read at runtime: the updater feed must be
// fixed to whichever repo actually published the binary. A fork that ships its
// own AppImage sets ORCA_RELEASE_REPO=<owner>/<repo> for both `build:release`
// and electron-builder, so app-update.yml and the hard-coded feed fallbacks in
// `src/main/updater.ts` agree. Unset — every upstream and contributor build —
// folds to the literal `stablyai/orca`, so behaviour is unchanged by default.
// Why validated here and not in the shared module: an unknown id is a typo in
// the release workflow, and failing the build is the only place that catches it
// before a capability someone meant to disable quietly ships enabled.
const ORCA_DISABLED_CAPABILITIES_LITERAL = (() => {
  const requested = (process.env.ORCA_DISABLED_CAPABILITIES ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  const unknown = requested.filter((entry) => !isDisableableCapability(entry))
  if (unknown.length > 0) {
    throw new Error(
      `ORCA_DISABLED_CAPABILITIES lists unknown ids: ${unknown.join(', ')}. ` +
        `Known ids: ${DISABLEABLE_CAPABILITIES.join(', ')}`
    )
  }
  return JSON.stringify(requested.join(','))
})()
const orcaReleaseRepo = process.env.ORCA_RELEASE_REPO
const ORCA_RELEASE_REPO_LITERAL =
  typeof orcaReleaseRepo === 'string' && /^[^/\s]+\/[^/\s]+$/.test(orcaReleaseRepo)
    ? JSON.stringify(orcaReleaseRepo)
    : JSON.stringify('stablyai/orca')

/** Adds the fork's constants to a bundle's define block. Main needs both; the renderer
 *  needs the capability list because the Settings sidebar and the Cmd+J palette filter
 *  on it, and taking the release repo too keeps its feed links on the repo that shipped. */
export function withErliBuildDefines(define: Record<string, string>): Record<string, string> {
  return {
    ...define,
    ORCA_RELEASE_REPO: ORCA_RELEASE_REPO_LITERAL,
    ORCA_DISABLED_CAPABILITIES: ORCA_DISABLED_CAPABILITIES_LITERAL
  }
}
