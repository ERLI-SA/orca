import { afterEach, describe, expect, it, vi } from 'vitest'

// Why this test exists: upstream's native chat seeds new chats as Full access from
// a default independent of DEFAULT_TUI_AGENT_ARGS, so emptying those for
// yolo-default left chats launching with every permission bypassed.
describe('native chat permission default', () => {
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
    expect(getDefaultSettings('/home/user').nativeChatPermissionMode).toBe('ask')
  })

  it("keeps upstream's Full access when yolo-default ships", async () => {
    const { getDefaultSettings } = await loadWithDisabled('')
    expect(getDefaultSettings('/home/user').nativeChatPermissionMode).toBe('full-access')
  })
})
