import { afterEach, describe, expect, it, vi } from 'vitest'

// Why this test exists: upstream added background push (push.onorca.dev) after the
// fork compiled out Orca Mobile, and started it on both the desktop and the orcad
// path without any relation to the mobile capability. A build without mobile must
// never construct the gateway client.
describe('background push in a build without mobile', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  async function loadWithDisabled(disabled: string) {
    vi.resetModules()
    vi.stubGlobal('ORCA_DISABLED_CAPABILITIES', disabled)
    return import('./desktop-push-service')
  }

  function createOptions() {
    return {
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: create() must return before reading any runtime member.
      runtime: {} as never,
      runtimeRpc: {
        getE2EEKeypair: vi.fn(() => ({ publicKey: 'pk', secretKey: 'sk' })),
        getDeviceRegistry: vi.fn(() => ({})),
        getPushUnregisterOutbox: vi.fn(() => ({}))
      },
      gatewayUrl: 'https://push.onorca.dev'
    }
  }

  it('creates no push service, so nothing reaches push.onorca.dev', async () => {
    const { DesktopPushService } = await loadWithDisabled('mobile')
    const options = createOptions()
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the stub covers every member create() reads.
    expect(DesktopPushService.create(options as never)).toBeNull()
    expect(options.runtimeRpc.getE2EEKeypair).not.toHaveBeenCalled()
  })

  it('still creates it when mobile ships', async () => {
    const { DesktopPushService } = await loadWithDisabled('')
    const options = createOptions()
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the stub covers every member create() reads.
    expect(DesktopPushService.create(options as never)).not.toBeNull()
  })
})
