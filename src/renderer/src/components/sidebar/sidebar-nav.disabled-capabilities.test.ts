import { afterEach, describe, expect, it, vi } from 'vitest'

// Why this test exists: hiding a Settings section is not the same as disabling a
// capability. Orca Mobile shipped visible in a build meant to be without it
// because the sidebar carries its own entry, defaulted on, with no relation to
// the nav registry. These are the affordances that reach a disabled capability
// from somewhere other than Settings.
describe('capability gates outside Settings', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  async function withDisabled<T>(disabled: string, load: () => Promise<T>): Promise<T> {
    vi.resetModules()
    vi.stubGlobal('ORCA_DISABLED_CAPABILITIES', disabled)
    return load()
  }

  it('hides the sidebar Orca Mobile entry even though its setting defaults to on', async () => {
    const { shouldShowMobileButton } = await withDisabled('mobile', () => import('./SidebarNav'))
    expect(shouldShowMobileButton({ showMobileButton: true })).toBe(false)
    expect(shouldShowMobileButton(undefined)).toBe(false)
  })

  it('keeps the sidebar Orca Mobile entry when the capability ships', async () => {
    const { shouldShowMobileButton } = await withDisabled('', () => import('./SidebarNav'))
    expect(shouldShowMobileButton(undefined)).toBe(true)
    expect(shouldShowMobileButton({ showMobileButton: false })).toBe(false)
  })

  it('hides the sidebar Artifacts entry, whose page opens on an Orca sign-in', async () => {
    const { shouldShowArtifactsButton } = await withDisabled(
      'artifacts',
      () => import('./SidebarNav')
    )
    expect(shouldShowArtifactsButton({ showArtifactsButton: true })).toBe(false)
  })

  it('leaves every other sidebar entry alone', async () => {
    const { shouldShowSkillsButton, shouldShowAutomationsButton } = await withDisabled(
      'mobile,artifacts',
      () => import('./SidebarNav')
    )
    expect(shouldShowSkillsButton({ showSkillsButton: true })).toBe(true)
    expect(shouldShowAutomationsButton({ showAutomationsButton: true })).toBe(true)
  })

  it('makes every skill ineligible to share, which disarms both share affordances', async () => {
    const { isSkillShareEligible } = await withDisabled(
      'share-skills',
      () => import('../skills/skill-share-selection')
    )
    expect(
      isSkillShareEligible(
        { installed: true, sourceKind: 'home' } as Parameters<typeof isSkillShareEligible>[0],
        true
      )
    ).toBe(false)
  })
})
