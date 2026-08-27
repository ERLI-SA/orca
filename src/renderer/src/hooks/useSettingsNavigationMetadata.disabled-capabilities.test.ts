import { afterEach, describe, expect, it, vi } from 'vitest'
import { SETTINGS_SECTION_CAPABILITIES } from '../../../shared/disabled-capabilities'
import { buildSettingsNavigationMetadata } from './useSettingsNavigationMetadata'

// Why this test exists: the capability gate works only because a capability id
// and its Settings nav id are the same string. An upstream rename would leave
// the section visible in a build meant to ship without it, and nothing else
// would fail.
describe('SETTINGS_SECTION_CAPABILITIES against the nav registry', () => {
  it('every entry still names a section the registry emits', () => {
    const sectionIds = new Set(
      buildSettingsNavigationMetadata({
        isMac: false,
        isWindows: false,
        isWebClient: false,
        isDev: true,
        isLinearConnected: true,
        repos: []
      }).map((section) => section.id)
    )
    for (const capability of SETTINGS_SECTION_CAPABILITIES) {
      expect(sectionIds).toContain(capability)
    }
  })
})

// Why the global rather than the build constant: `define` substitutes a literal
// at build time, and the module's `typeof` guard falls through to the global
// when no bundler ran. Setting it before a fresh import is the only way a test
// can observe a build that shipped without a capability.
describe('a build with capabilities disabled', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  async function buildNavSectionIds(disabled: string): Promise<Set<string>> {
    vi.resetModules()
    vi.stubGlobal('ORCA_DISABLED_CAPABILITIES', disabled)
    const { buildSettingsNavigationMetadata: build } =
      await import('./useSettingsNavigationMetadata')
    return new Set(
      build({
        isMac: false,
        isWindows: false,
        isWebClient: false,
        isDev: true,
        isLinearConnected: true,
        repos: []
      }).map((section) => section.id)
    )
  }

  it('drops every disabled section from the registry', async () => {
    const disabled = [...SETTINGS_SECTION_CAPABILITIES]
    const sectionIds = await buildNavSectionIds(disabled.join(','))
    for (const capability of disabled) {
      expect(sectionIds).not.toContain(capability)
    }
  })

  it('keeps the sections it was not asked to drop', async () => {
    const sectionIds = await buildNavSectionIds('privacy')
    expect(sectionIds).not.toContain('privacy')
    expect(sectionIds).toContain('terminal')
    expect(sectionIds).toContain('computer-use')
  })
})
