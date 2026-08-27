import { describe, expect, it } from 'vitest'
import {
  DISABLEABLE_CAPABILITIES,
  isCapabilityDisabled,
  isCapabilityEnabled,
  isDisableableCapability,
  isSettingsSectionDisabled,
  parseDisabledCapabilities,
  SETTINGS_SECTION_CAPABILITIES
} from './disabled-capabilities'

describe('parseDisabledCapabilities', () => {
  it('reads the comma-separated build constant, tolerating spacing', () => {
    expect([...parseDisabledCapabilities(' mobile , privacy ')]).toEqual(['mobile', 'privacy'])
  })

  it('treats an empty constant as "nothing disabled"', () => {
    expect(parseDisabledCapabilities('').size).toBe(0)
  })

  it('drops ids it does not know rather than throwing inside a shared module', () => {
    expect([...parseDisabledCapabilities('mobile,not-a-capability')]).toEqual(['mobile'])
  })

  it('collapses a repeated id', () => {
    expect([...parseDisabledCapabilities('mobile,mobile')]).toEqual(['mobile'])
  })
})

describe('isDisableableCapability', () => {
  it('accepts every declared id', () => {
    for (const capability of DISABLEABLE_CAPABILITIES) {
      expect(isDisableableCapability(capability)).toBe(true)
    }
  })

  it('rejects a section id that is not a declared capability', () => {
    expect(isDisableableCapability('terminal')).toBe(false)
  })
})

describe('build without ORCA_DISABLED_CAPABILITIES', () => {
  // Why asserted: tests and the CLI carry no define block, and a capability that
  // silently defaulted to disabled there would break unrelated suites.
  it('leaves every capability enabled', () => {
    for (const capability of DISABLEABLE_CAPABILITIES) {
      expect(isCapabilityDisabled(capability)).toBe(false)
      expect(isCapabilityEnabled(capability)).toBe(true)
    }
    expect(isSettingsSectionDisabled('privacy')).toBe(false)
  })
})

describe('SETTINGS_SECTION_CAPABILITIES', () => {
  it('lists only declared capabilities', () => {
    for (const capability of SETTINGS_SECTION_CAPABILITIES) {
      expect(isDisableableCapability(capability)).toBe(true)
    }
  })
})
