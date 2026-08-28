import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { compareAppVersions, isValidAppVersion } from '../../src/shared/app-version'

// Why this file exists: the fork publishes several builds from one upstream tag,
// so the version is what makes a rebuild installable. Two comparators decide
// that — semver inside the app, dpkg for apt — and they disagree about hyphens.
// Every assertion here failed at least once while the scheme was being chosen.

function erliVersion(buildNumber) {
  const output = execFileSync(
    process.execPath,
    [
      '-e',
      "const c = require('./config/electron-builder.config.cjs'); console.log(c.extraMetadata.version)"
    ],
    { env: { ...process.env, ORCA_ERLI_BUILD_NUMBER: String(buildNumber) }, encoding: 'utf8' }
  )
  return output.trim()
}

/** electron-builder rewrites hyphens to tildes in the deb Version field. */
function debVersion(buildNumber) {
  return erliVersion(buildNumber).replace(/-/g, '~')
}

function dpkgGreater(left, right) {
  try {
    execFileSync('dpkg', ['--compare-versions', left, 'gt', right])
    return true
  } catch {
    return false
  }
}

describe('ERLI build version', () => {
  it("is the fork's own 1.0.x line, carrying the upstream tag it was built from", () => {
    expect(erliVersion(7)).toBe('1.0.7-erli-upstream.1.4.190')
  })

  it('is absent unless a build number is set, so local builds stay upstream', () => {
    const output = execFileSync(
      process.execPath,
      [
        '-e',
        "console.log(JSON.stringify(require('./config/electron-builder.config.cjs').extraMetadata ?? null))"
      ],
      { env: { ...process.env, ORCA_ERLI_BUILD_NUMBER: '' }, encoding: 'utf8' }
    )
    expect(JSON.parse(output.trim())).toBeNull()
  })

  it('rejects a build number that is not a positive integer', () => {
    expect(() => erliVersion('7; rm -rf /')).toThrow()
  })

  it('parses as a version the app itself accepts', () => {
    expect(isValidAppVersion(erliVersion(7))).toBe(true)
  })
})

describe('ordering', () => {
  // Why 9→10 and 99→100 specifically: a build number placed in a prerelease
  // identifier next to a hyphen compares as text, so `erli.10-upstream` sorts
  // below `erli.9-upstream`. Keeping it in the numeric patch avoids that, and
  // this is the assertion that catches a regression back to the broken shape.
  for (const [higher, lower] of [
    [6, 5],
    [10, 9],
    [100, 99]
  ]) {
    it(`orders build ${lower} below build ${higher} in semver`, () => {
      expect(compareAppVersions(erliVersion(higher), erliVersion(lower))).toBeGreaterThan(0)
    })

    it(`orders build ${lower} below build ${higher} in dpkg`, () => {
      expect(dpkgGreater(debVersion(higher), debVersion(lower))).toBe(true)
    })
  }
})
