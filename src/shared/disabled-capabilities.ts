// Capabilities a distribution can compile out. ERLI's Linux build turns off the
// ones that reach stablyai-operated services, because a corporate checkout must
// not publish its contents to a hosting account nobody here controls.
//
// Substituted at build time from ORCA_DISABLED_CAPABILITIES (see
// `src/types/build-constants.d.ts`) rather than read from an env var, so a user
// cannot re-enable a capability the build deliberately shipped without.
//
// Ids that name a Settings section match that section's nav id exactly, so
// disabling one drops both the sidebar entry and the Cmd+J palette entry.

export const DISABLEABLE_CAPABILITIES = [
  /** Settings > Artifacts, and publishing to share.onorca.dev. */
  'artifacts',
  /** Settings > Computer Use — agents driving other apps on the machine. */
  'computer-use',
  /** Help > Report Crash, and the diagnostic bundle it uploads. */
  'crash-report',
  /** Sidebar Help > Send Feedback → www.onorca.dev/v1/feedback. */
  'feedback',
  /** Settings > Orca Mobile, and pairing through relay.onorca.dev. */
  'mobile',
  /** Settings > Orca Account → login.onorca.dev, relay.onorca.dev. */
  'orca-account',
  /** Settings > Plugins: the marketplace, and the kill-list fetched on launch. */
  'plugins',
  /** Settings > Privacy & Telemetry. */
  'privacy',
  /** Settings > Remote Orca Servers. */
  'servers',
  /** Settings > Share Skills → app.orca.dev, share.onorca.dev. */
  'share-skills',
  /** The "star Orca on GitHub" prompt, which acts on the user's gh account. */
  'star-prompt',
  /** Changelog and update-nudge polling against onorca.dev/whats-new. */
  'whats-new',
  /**
   * Launching every agent with its permission-bypass flag by default —
   * `--dangerously-skip-permissions`, `--dangerously-bypass-approvals-and-sandbox`,
   * `--yolo`. Disabling this makes the default launch ask for consent; the user can
   * still opt in per agent, or for all of them, in Settings > Agents.
   */
  'yolo-default'
] as const

export type DisableableCapability = (typeof DISABLEABLE_CAPABILITIES)[number]

export function isDisableableCapability(value: string): value is DisableableCapability {
  return (DISABLEABLE_CAPABILITIES as readonly string[]).includes(value)
}

/** Parses the build constant's comma-separated form. Unknown ids are rejected
 *  by `electron.vite.config.ts` at build time, so silently ignore them here
 *  rather than throwing inside a module every surface imports. */
export function parseDisabledCapabilities(value: string): ReadonlySet<DisableableCapability> {
  const parsed = new Set<DisableableCapability>()
  for (const entry of value.split(',')) {
    const trimmed = entry.trim()
    if (isDisableableCapability(trimmed)) {
      parsed.add(trimmed)
    }
  }
  return parsed
}

// The `typeof` guard keeps this usable from bundles with no define block (tests,
// the CLI), where every capability stays enabled.
const DISABLED = parseDisabledCapabilities(
  typeof ORCA_DISABLED_CAPABILITIES !== 'undefined' ? ORCA_DISABLED_CAPABILITIES : ''
)

export function isCapabilityDisabled(capability: DisableableCapability): boolean {
  return DISABLED.has(capability)
}

export function isCapabilityEnabled(capability: DisableableCapability): boolean {
  return !DISABLED.has(capability)
}

/** The capabilities whose id is also a Settings section's nav id. Keeping the
 *  two strings identical is what lets one filter drop the sidebar entry, the
 *  pane, and the Cmd+J palette entry — a drift test asserts each id still names
 *  a real section. The remaining capabilities gate surfaces outside Settings. */
export const SETTINGS_SECTION_CAPABILITIES = [
  'artifacts',
  'computer-use',
  'mobile',
  'orca-account',
  'plugins',
  'privacy',
  'servers',
  'share-skills'
] as const satisfies readonly DisableableCapability[]

export function isSettingsSectionDisabled(sectionId: string): boolean {
  return (
    (SETTINGS_SECTION_CAPABILITIES as readonly string[]).includes(sectionId) &&
    isCapabilityDisabled(sectionId as DisableableCapability)
  )
}
