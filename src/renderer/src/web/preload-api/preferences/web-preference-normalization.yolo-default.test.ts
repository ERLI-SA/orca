import { afterEach, describe, expect, it, vi } from 'vitest'

// Why this test exists: upstream's #43403 moved the browser-saved permission migration
// and swapped the gated DEFAULT_TUI_AGENT_* for the raw YOLO_TUI_AGENT_*, so a legacy
// web settings blob that named one agent migrated every other agent to Full access.
describe('yolo-default capability: browser-saved agent permissions', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  async function migrate(disabled: string) {
    vi.resetModules()
    vi.stubGlobal('ORCA_DISABLED_CAPABILITIES', disabled)
    const { migrateStoredWebSettings } = await import('./web-preference-normalization')
    // A legacy blob: the user cleared Codex's args and never touched Claude.
    return migrateStoredWebSettings({ agentDefaultArgs: { codex: '' } })
  }

  it('does not lift untouched agents to Full access when disabled', async () => {
    const migrated = await migrate('yolo-default')
    expect(migrated.agentPermissionDefault).not.toBe('full-access')
    expect(JSON.stringify(migrated)).not.toContain('full-access')
  })

  it('keeps upstream behaviour when the capability ships', async () => {
    const migrated = await migrate('')
    expect(JSON.stringify(migrated)).toContain('full-access')
  })
})
