import { afterEach, describe, expect, it, vi } from 'vitest'

// Why this test exists: upstream defaults the plugin system on and, at launch, fetches
// the kill list and install stats from orca.dev and clones the official marketplace.
// In 1.4.264 the fork's gates moved out of main-process-plugins.ts (it sits at its
// max-lines budget) into these two fetch helpers, so they are what must hold.
describe('plugins capability: launch-time network', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  async function load(disabled: string) {
    vi.resetModules()
    vi.stubGlobal('ORCA_DISABLED_CAPABILITIES', disabled)
    const bounded = await import('./plugin-bounded-json-fetch')
    const marketplace = await import('./plugin-marketplace-fetch')
    return { ...bounded, ...marketplace }
  }

  const options = { label: 'kill list', maxBytes: 1024, timeoutMs: 1000 }

  it('never calls the fetcher when plugins are compiled out', async () => {
    const m = await load('plugins')
    const fetcher = vi.fn()
    await expect(
      m.fetchBoundedJson(fetcher as unknown as typeof fetch, 'https://orca.dev/x', options)
    ).rejects.toThrow('not available')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('does not clone a marketplace when plugins are compiled out', async () => {
    const m = await load('plugins')
    await expect(
      m.fetchPluginMarketplace({
        source: { url: 'https://github.com/example/marketplace.git' }
      } as Parameters<typeof m.fetchPluginMarketplace>[0])
    ).rejects.toThrow('not available')
  })

  it('still fetches when plugins ship', async () => {
    const m = await load('')
    const fetcher = vi.fn(async () => new Response('{"ok":true}'))
    await expect(
      m.fetchBoundedJson(fetcher as unknown as typeof fetch, 'https://orca.dev/x', options)
    ).resolves.toEqual({ ok: true })
    expect(fetcher).toHaveBeenCalledOnce()
  })
})
