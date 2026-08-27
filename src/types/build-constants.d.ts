// Ambient declarations for compile-time constants substituted by the build
// configs. The telemetry constants live in electron-vite's main `define`
// block; contributor / `pnpm dev` / third-party builds substitute literal
// `null`, which `IS_OFFICIAL_BUILD` in `src/main/telemetry/client.ts`
// evaluates to `false` at module load — such builds console-mirror only.
//
// The CI release workflow (and only the CI release workflow) provides real
// values via GitHub Actions secrets. There is no runtime env-var fallback;
// the substitution happens at compile time so a curious contributor cannot
// spoof transmission with a shell export.
//
declare const ORCA_BUILD_IDENTITY: 'stable' | 'rc' | null
declare const ORCA_POSTHOG_WRITE_KEY: string | null

// Diagnostic-bundle upload endpoint for Mode 3 (telemetry-error-tracking.md
// §Endpoint contract). Substituted by CI; `null` in contributor builds, at
// which point the upload IPC handler returns "endpoint not configured"
// rather than POSTing to a placeholder. The dev escape hatch is the
// `ORCA_DIAGNOSTICS_TOKEN_URL` env var, which env wins so a developer can
// point a packaged build at a staging server without re-running the
// release pipeline.
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
