import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

// Why this file exists: electron-updater Authenticode-verifies every Windows update
// against the publisherName baked into the installed app. ERLI ships unsigned, so a
// build that kept upstream's 'SignPath Foundation' would reject every later ERLI build.

function winConfig(buildNumber) {
  const output = execFileSync(
    process.execPath,
    [
      '-e',
      "const c = require('./config/electron-builder.config.cjs'); console.log(JSON.stringify({ publisherName: c.win.signtoolOptions.publisherName ?? null, verify: c.win.verifyUpdateCodeSignature ?? null }))"
    ],
    {
      env: {
        ...process.env,
        ORCA_ERLI_BUILD_NUMBER: buildNumber,
        ORCA_WIN_HOURLY: '',
        ORCA_WIN_DAILY: '',
        ORCA_WIN_ADHOC: ''
      },
      encoding: 'utf8'
    }
  )
  return JSON.parse(output)
}

describe('ERLI Windows signing', () => {
  it('claims no publisher and skips update signature checks in an ERLI build', () => {
    expect(winConfig('7')).toEqual({ publisherName: null, verify: false })
  })

  it("keeps upstream's SignPath publisher when no build number is set", () => {
    expect(winConfig('')).toEqual({ publisherName: 'SignPath Foundation', verify: null })
  })
})
