import { afterEach, describe, expect, it, vi } from 'vitest'

// Why this test exists: upstream's defaults hand every agent its permission-bypass
// flag — first as default launch args, now as a stored Full access choice — so an
// agent started before anyone opens Settings runs with consent skipped. The gate has
// to hold at the launch resolver, not just in the UI.
describe('yolo-default capability', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  async function load(disabled: string) {
    vi.resetModules()
    vi.stubGlobal('ORCA_DISABLED_CAPABILITIES', disabled)
    const launch = await import('./tui-agent-launch-defaults.js')
    const { getDefaultSettings } = await import('./constants.js')
    return { ...launch, newProfile: getDefaultSettings('/home/user') }
  }

  it('hands out no legacy default args or env when disabled', async () => {
    const m = await load('yolo-default')
    expect(m.DEFAULT_TUI_AGENT_ARGS).toEqual({})
    expect(m.DEFAULT_TUI_AGENT_ENV).toEqual({})
    expect(m.getTuiAgentDefaultArgs('claude')).toBe('')
    expect(m.getTuiAgentDefaultEnv('goose')).toEqual({})
  })

  it('launches agents from a new profile without a bypass flag', async () => {
    const m = await load('yolo-default')
    expect(m.newProfile.agentPermissionDefault).toBe('own')
    expect(m.resolveTuiAgentLaunchArgs('claude', m.newProfile)).toBe('')
    expect(m.resolveTuiAgentLaunchArgs('codex', m.newProfile)).toBe('')
    expect(m.resolveTuiAgentLaunchArgs('claude', undefined)).toBe('')
  })

  it('still honours an explicit opt-in, because only the default changed', async () => {
    const m = await load('yolo-default')
    expect(
      m.resolveTuiAgentLaunchArgs('claude', {
        ...m.newProfile,
        agentPermissionDefault: 'full-access'
      })
    ).toContain('--dangerously-skip-permissions')
  })

  it('keeps upstream behaviour when the capability ships', async () => {
    const m = await load('')
    expect(m.newProfile.agentPermissionDefault).toBe('full-access')
    expect(m.getTuiAgentDefaultArgs('claude')).toBe('--dangerously-skip-permissions')
    expect(m.resolveTuiAgentLaunchArgs('codex', m.newProfile)).toContain(
      '--dangerously-bypass-approvals-and-sandbox'
    )
  })
})
