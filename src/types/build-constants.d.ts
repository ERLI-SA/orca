// CI release builds substitute telemetry credentials; contributor builds use null and console-mirror only.
// No runtime env fallback: shell exports must not enable telemetry transmission.
declare const ORCA_BUILD_IDENTITY: 'stable' | 'rc' | null
declare const ORCA_POSTHOG_WRITE_KEY: string | null

// CI supplies the diagnostics token endpoint; null disables upload in contributor builds.
// ORCA_DIAGNOSTICS_TOKEN_URL overrides it for developers testing packaged builds against staging.
declare const ORCA_DIAGNOSTICS_TOKEN_URL: string | null

// The GitHub repo (`owner/name`) that published this binary. The updater's feed
// URLs and the releases atom feed are derived from it, so a fork that ships its
// own artifacts updates from its own releases instead of upstream's. Substituted
// by electron-vite's main `define` block from `ORCA_RELEASE_REPO`; every build
// that does not set it gets the literal `stablyai/orca`.
declare const ORCA_RELEASE_REPO: string

// Comma-separated capability ids this build ships without, parsed by
// `src/shared/disabled-capabilities.ts`. Substituted into the main, renderer and
// web bundles from ORCA_DISABLED_CAPABILITIES; empty in builds that set nothing,
// which keeps every capability enabled.
declare const ORCA_DISABLED_CAPABILITIES: string

// Full commit the build was made from (`git rev-parse HEAD`); official skill installs pin to it.
declare const ORCA_BUILD_COMMIT: string

// ORCA_LAYOUT_OWNER is declared and read in one place: src/shared/layout-owner-switch.ts.
