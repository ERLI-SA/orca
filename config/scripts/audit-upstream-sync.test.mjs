import { describe, expect, it } from 'vitest'
import {
  added,
  buildReport,
  classifyPath,
  computeSignals,
  computeVerdict,
  extractActionUses,
  extractDependencyNames,
  extractHosts,
  extractIpcChannels,
  extractLockPackageNames,
  formatBaseline,
  parseBaseline
} from './audit-upstream-sync.mjs'

const BASELINE_TEXT = [
  '# The upstream commit ERLI has audited up to.',
  '#',
  '# Format: one line.',
  `${'a'.repeat(40)} 2026-08-28 auditor@example.com`,
  ''
].join('\n')

function emptyInventory(overrides = {}) {
  return {
    hosts: new Set(),
    ipcChannels: new Set(),
    childProcessImporters: new Set(),
    dependencies: new Set(),
    lockPackages: new Set(),
    patches: new Set(),
    workflowUses: new Set(),
    ...overrides
  }
}

describe('classifyPath', () => {
  it('puts the main process, preload, native and CI on P0', () => {
    expect(classifyPath('src/main/ipc/pty.ts').tier).toBe('P0')
    expect(classifyPath('src/preload/index.ts').tier).toBe('P0')
    expect(classifyPath('native/computer-use-linux/main.cc').tier).toBe('P0')
    expect(classifyPath('.github/workflows/pr.yml').tier).toBe('P0')
    expect(classifyPath('pnpm-lock.yaml').tier).toBe('P0')
    expect(classifyPath('config/patches/node-pty@1.1.0.patch').tier).toBe('P0')
    expect(classifyPath('electron.vite.config.ts').tier).toBe('P0')
  })

  it('demotes tests ahead of every path rule, because they do not ship', () => {
    expect(classifyPath('src/main/ipc/pty.test.ts')).toEqual({ tier: 'P2', reason: 'test' })
    expect(classifyPath('config/scripts/check-max-lines-ratchet.test.mjs').tier).toBe('P2')
    expect(classifyPath('tests/e2e/helpers/orca-app.ts').tier).toBe('P2')
  })

  it('falls back to P1 rather than P2 for a path no rule names', () => {
    expect(classifyPath('some-new-top-level/thing.ts')).toEqual({
      tier: 'P1',
      reason: 'unclassified'
    })
  })
})

describe('parseBaseline', () => {
  it('reads the first non-comment line', () => {
    expect(parseBaseline(BASELINE_TEXT)).toEqual({
      sha: 'a'.repeat(40),
      date: '2026-08-28',
      auditor: 'auditor@example.com'
    })
  })

  it('refuses an abbreviated sha, which would silently resolve to a different commit later', () => {
    expect(() => parseBaseline('abc1234 2026-08-28 auditor@example.com')).toThrow(
      /40-character sha/
    )
  })

  it('refuses a file with no baseline line', () => {
    expect(() => parseBaseline('# only comments\n\n')).toThrow(/no baseline line/)
  })
})

describe('formatBaseline', () => {
  it('keeps the comment block and replaces only the entry', () => {
    const next = formatBaseline(BASELINE_TEXT, {
      sha: 'b'.repeat(40),
      date: '2026-09-11',
      auditor: 'other@example.com'
    })
    expect(next).toContain('# The upstream commit ERLI has audited up to.')
    expect(next).not.toContain('a'.repeat(40))
    expect(next.trimEnd().split('\n').at(-1)).toBe(`${'b'.repeat(40)} 2026-09-11 other@example.com`)
  })
})

describe('extractHosts', () => {
  it('keeps real destinations and drops fixtures, loopback and prose', () => {
    const hosts = extractHosts(
      [
        'https://share.onorca.dev',
        'https://api.github.com',
        'https://example.com',
        'http://localhost',
        'http://127.0.0.1',
        'https://orca-cloud.example',
        'https://google maps'
      ].join('\n')
    )
    expect([...hosts].sort()).toEqual(['api.github.com', 'share.onorca.dev'])
  })
})

describe('extractIpcChannels', () => {
  it('reads the channel name from handle and on registrations', () => {
    const channels = extractIpcChannels(
      "ipcMain.handle('pty:spawn'\nipcMain.on( 'agentStatus:drop'\nipcRenderer.invoke('nope'"
    )
    expect([...channels].sort()).toEqual(['agentStatus:drop', 'pty:spawn'])
  })
})

describe('extractLockPackageNames', () => {
  // pnpm quotes the scoped keys and leaves the plain ones bare; missing the quoted
  // form would hide every new scoped package, which is most of the graph.
  it('reads plain, scoped and quoted names, ignoring the version', () => {
    const lock = [
      'packages:',
      '',
      '  /node-pty@1.1.0:',
      '    resolution: {integrity: sha512-x}',
      "  '@xterm/xterm@6.1.0-beta.287':",
      '    resolution: {integrity: sha512-y}',
      "  '@babel/core@7.28.0(supports-color@8.1.1)':",
      '    resolution: {integrity: sha512-z}'
    ].join('\n')
    expect([...extractLockPackageNames(lock)].sort()).toEqual([
      '@babel/core',
      '@xterm/xterm',
      'node-pty'
    ])
  })
})

describe('extractDependencyNames', () => {
  it('merges runtime, dev and optional dependencies', () => {
    const names = extractDependencyNames(
      JSON.stringify({
        dependencies: { electron: '1' },
        devDependencies: { vitest: '2' },
        optionalDependencies: { fsevents: '3' }
      })
    )
    expect([...names].sort()).toEqual(['electron', 'fsevents', 'vitest'])
  })
})

describe('extractActionUses', () => {
  it('reads every action reference in a workflow', () => {
    const workflow = ['jobs:', '  build:', '    steps:', '      - uses: actions/checkout@v6'].join(
      '\n'
    )
    expect([...extractActionUses(workflow)]).toEqual(['actions/checkout@v6'])
  })
})

describe('added', () => {
  it('reports only what the head has and the baseline did not', () => {
    expect(added(new Set(['a', 'b']), new Set(['b', 'c']))).toEqual(['c'])
  })
})

describe('computeSignals', () => {
  it('drops the signals with nothing to report', () => {
    const signals = computeSignals(
      emptyInventory(),
      emptyInventory({ hosts: new Set(['telemetry.example-vendor.io']) })
    )
    expect(signals.map((signal) => signal.key)).toEqual(['new-outbound-hosts'])
    expect(signals[0].entries).toEqual(['telemetry.example-vendor.io'])
  })

  it('reports a rewritten patch by path, not by blob sha', () => {
    const signals = computeSignals(
      emptyInventory({ patches: new Set(['config/patches/node-pty@1.1.0.patch@aaa']) }),
      emptyInventory({ patches: new Set(['config/patches/node-pty@1.1.0.patch@bbb']) })
    )
    expect(signals[0].entries).toEqual(['config/patches/node-pty@1.1.0.patch'])
  })
})

describe('computeVerdict', () => {
  it('lets a P2-only delta with no signals through', () => {
    const verdict = computeVerdict([{ path: 'docs/a.md', tier: 'P2' }], [], [])
    expect(verdict).toEqual({ auditRequired: false, exitCode: 0 })
  })

  it('requires a round when upstream touched a fork-owned file, even with no P0 and no signal', () => {
    const verdict = computeVerdict(
      [{ path: 'src/renderer/src/components/sidebar/SidebarNav.tsx', tier: 'P2' }],
      [],
      [{ path: 'src/renderer/src/components/sidebar/SidebarNav.tsx', tier: 'P2' }]
    )
    expect(verdict).toEqual({ auditRequired: true, exitCode: 1 })
  })
})

describe('buildReport', () => {
  it('leads with the fork-owned contact points and states the verdict', () => {
    const forkContact = [
      {
        path: 'src/shared/disabled-capabilities.ts',
        tier: 'P1',
        reason: 'shared contract',
        added: 3,
        deleted: 1
      }
    ]
    const report = buildReport({
      base: { sha: 'a'.repeat(40), date: '2026-08-28', auditor: 'auditor@example.com' },
      headRef: 'upstream/main',
      headSha: 'b'.repeat(40),
      commitCount: '42',
      changedFiles: forkContact,
      signals: [],
      forkContact,
      verdict: { auditRequired: true, exitCode: 1 }
    })
    expect(report).toContain('audit required before merge')
    expect(report).toContain('## Fork-owned files upstream changed')
    expect(report.indexOf('## Fork-owned files')).toBeLessThan(report.indexOf('## P1'))
  })
})
