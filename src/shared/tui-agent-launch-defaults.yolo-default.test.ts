import { afterEach, describe, expect, it, vi } from 'vitest'

// Why this test exists: upstream's default launch args ARE the permission-bypass
// args, so an agent started before anyone opens Settings runs with consent
// skipped. The gate has to hold at the launch resolver, not just in the UI.
describe('yolo-default capability', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  async function load(disabled: string) {
    vi.resetModules()
    vi.stubGlobal('ORCA_DISABLED_CAPABILITIES', disabled)
    return import('./tui-agent-launch-defaults.js')
  }

  it('hands out no default args or env when disabled', async () => {
    const m = await load('yolo-default')
    expect(m.DEFAULT_TUI_AGENT_ARGS).toEqual({})
    expect(m.DEFAULT_TUI_AGENT_ENV).toEqual({})
    expect(m.getTuiAgentDefaultArgs('claude')).toBe('')
    expect(m.getTuiAgentDefaultEnv('goose')).toEqual({})
  })

  it('launches an unconfigured agent without a bypass flag', async () => {
    const m = await load('yolo-default')
    expect(m.resolveTuiAgentLaunchArgs('claude', undefined)).toBe('')
    expect(m.resolveTuiAgentLaunchArgs('codex', null)).toBe('')
    expect(m.resolveTuiAgentLaunchEnv('goose', undefined)).toEqual({})
  })

  it('still honours an explicit opt-in, because only the default changed', async () => {
    const m = await load('yolo-default')
    expect(
      m.resolveTuiAgentLaunchArgs('claude', { claude: '--dangerously-skip-permissions' })
    ).toBe('--dangerously-skip-permissions')
  })

  it('keeps upstream behaviour when the capability ships', async () => {
    const m = await load('')
    expect(m.getTuiAgentDefaultArgs('claude')).toBe('--dangerously-skip-permissions')
    expect(m.resolveTuiAgentLaunchArgs('codex', undefined)).toBe(
      '--dangerously-bypass-approvals-and-sandbox'
    )
    expect(m.getTuiAgentDefaultEnv('goose')).toEqual({ GOOSE_MODE: 'auto' })
  })
})
