import { afterEach, describe, expect, it, vi } from 'vitest'

// Why this test exists: upstream's native chat seeds new chats as Full access from
// a default independent of DEFAULT_TUI_AGENT_ARGS, so emptying those for
// yolo-default left chats launching with every permission bypassed.
describe('agent and native chat permission defaults', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  async function loadWithDisabled(disabled: string) {
    vi.resetModules()
    vi.stubGlobal('ORCA_DISABLED_CAPABILITIES', disabled)
    return import('./constants')
  }

  it('asks when the build ships without yolo-default', async () => {
    const { getDefaultSettings } = await loadWithDisabled('yolo-default')
    const settings = getDefaultSettings('/home/user')
    expect(settings.nativeChatPermissionMode).toBe('ask')
    // Since agent permissions became a stored choice, this default decides what every agent launches with.
    expect(settings.agentPermissionDefault).toBe('own')
  })

  it("keeps upstream's Full access when yolo-default ships", async () => {
    const { getDefaultSettings } = await loadWithDisabled('')
    const settings = getDefaultSettings('/home/user')
    expect(settings.nativeChatPermissionMode).toBe('full-access')
    expect(settings.agentPermissionDefault).toBe('full-access')
  })
})
