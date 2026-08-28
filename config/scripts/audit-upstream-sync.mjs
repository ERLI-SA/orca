import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'

// Sync gate for merges from stablyai/orca. Upstream cuts two to three releases a
// week, which is more than anyone here can read line by line, so this triages the
// delta instead of reviewing it: it says which changed files must be read, and it
// diffs a handful of inventories — outbound hosts, IPC channels, direct
// child_process importers, dependencies, patches, workflow action pins — between
// the audited baseline and the incoming ref.
//
// Why inventories rather than scanning the diff hunks: a hunk scan reports every
// line that mentions a URL, and after two hundred commits that is thousands of
// lines nobody reads. An inventory diff reports only what did not exist before,
// which is the set an auditor can actually work through.
//
// Exit 1 means "an audit round is required before this merges", not "the code is
// bad". Most syncs will exit 1; that is the point. Exit 0 means the delta touched
// nothing that carries risk and can merge on the strength of CI alone.

const BASELINE_PATH = 'config/erli-upstream-audit-baseline.txt'
const DEFAULT_HEAD = 'upstream/main'
// Kept outside this repository; the workspace README says where.
const AUDIT_DOC = 'the ERLI audit doc (outside this repository)'

// Paths carrying an ERLI decision upstream does not know about — the capability
// gating, the fork's updater feed, the release workflow. Upstream touching one of
// these is the regression surface: a merge can resolve cleanly and still restore
// a capability this build ships without. Add a path here whenever a fork commit
// starts owning one.
export const FORK_OWNED_PATHS = [
  '.github/workflows/erli-linux-release.yml',
  'config/electron-builder.config.cjs',
  'config/tsconfig.cli.json',
  'config/tsconfig.tc.web.json',
  'config/tsconfig.web.json',
  'electron.vite.config.ts',
  'src/main/index.ts',
  'src/main/ipc/crash-reporting.ts',
  'src/main/ipc/register-core-handlers.ts',
  'src/main/ipc/skills.ts',
  'src/main/menu/register-app-menu.ts',
  'src/main/orca-profiles/profile-cloud-auth-config.ts',
  'src/main/runtime/rpc/methods/index.ts',
  'src/main/updater-changelog.ts',
  'src/main/updater-nudge.ts',
  'src/main/updater-prerelease-feed.ts',
  'src/main/updater.ts',
  'src/renderer/src/components/TelemetryFirstLaunchSurface.tsx',
  'src/renderer/src/components/new-workspace/RunTargetSubmenus.tsx',
  'src/renderer/src/components/settings/AppearanceWindowSidebarSection.tsx',
  'src/renderer/src/components/sidebar/AddRepoHostSelector.tsx',
  'src/renderer/src/components/sidebar/SidebarNav.tsx',
  'src/renderer/src/components/sidebar/SidebarSettingsHelpMenu.tsx',
  'src/renderer/src/components/skills/skill-share-selection.ts',
  'src/renderer/src/hooks/useSettingsNavigationMetadata.ts',
  'src/shared/artifact-sharing-gate.ts',
  'src/shared/disabled-capabilities.ts',
  'src/shared/release-channel.ts',
  'src/shared/tui-agent-launch-defaults.ts',
  'src/types/build-constants.d.ts',
  'vite.web.config.ts'
]

// First match wins. P0 is read line by line, P1 is read by Claude with a human
// confirming findings, P2 is sampled.
const TRIAGE_RULES = [
  // Tests do not ship. A changed test can still hide a removed guard, which is
  // what the P1 review of the file it covers is for.
  { tier: 'P2', reason: 'test', matches: (p) => /\.(test|spec)\.(ts|tsx|mjs)$/.test(p) },
  { tier: 'P0', reason: 'main process', matches: (p) => p.startsWith('src/main/') },
  { tier: 'P0', reason: 'preload bridge', matches: (p) => p.startsWith('src/preload/') },
  { tier: 'P0', reason: 'native module', matches: (p) => p.startsWith('native/') },
  { tier: 'P0', reason: 'CI workflow', matches: (p) => p.startsWith('.github/') },
  {
    tier: 'P0',
    reason: 'dependency graph',
    matches: (p) => p === 'pnpm-lock.yaml' || p === 'package.json'
  },
  { tier: 'P0', reason: 'third-party patch', matches: (p) => p.startsWith('config/patches/') },
  { tier: 'P0', reason: 'packaging', matches: (p) => p === 'config/electron-builder.config.cjs' },
  {
    tier: 'P0',
    reason: 'build define block',
    matches: (p) => /^(electron\.vite|vite\.web)\.config\.ts$/.test(p)
  },
  { tier: 'P1', reason: 'relay', matches: (p) => p.startsWith('src/relay/') },
  { tier: 'P1', reason: 'CLI', matches: (p) => p.startsWith('src/cli/') },
  { tier: 'P1', reason: 'shared contract', matches: (p) => p.startsWith('src/shared/') },
  {
    tier: 'P1',
    reason: 'bundled skill',
    matches: (p) => /^(skills|skill-stubs|skill-guides)\//.test(p)
  },
  { tier: 'P1', reason: 'shipped resource', matches: (p) => p.startsWith('resources/') },
  { tier: 'P1', reason: 'build script', matches: (p) => p.startsWith('config/') },
  { tier: 'P1', reason: 'mobile client', matches: (p) => p.startsWith('mobile/') },
  { tier: 'P2', reason: 'renderer', matches: (p) => p.startsWith('src/renderer/') },
  { tier: 'P2', reason: 'test harness', matches: (p) => p.startsWith('tests/') },
  { tier: 'P2', reason: 'docs', matches: (p) => p.startsWith('docs/') || p.endsWith('.md') }
]

const SOURCE_PATHSPECS = [
  'src',
  'config',
  'resources',
  'native',
  ':(exclude)**/*.test.ts',
  ':(exclude)**/*.test.tsx',
  ':(exclude)**/*.test.mjs',
  ':(exclude)**/*.snap'
]

// Hosts every build already talks to or that only ever appear in fixtures. Kept
// out of the report so a genuinely new destination is not buried.
const IGNORED_HOSTS =
  /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|.*\.example(\.[a-z]+)?|example\.(com|test|invalid|org|net)|.*\.test|.*\.invalid|www\.w3\.org|schemas?\..*)$/

export function classifyPath(filePath) {
  for (const rule of TRIAGE_RULES) {
    if (rule.matches(filePath)) {
      return { tier: rule.tier, reason: rule.reason }
    }
  }
  return { tier: 'P1', reason: 'unclassified' }
}

export function parseBaseline(text) {
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) {
      continue
    }
    const [sha, date, auditor] = line.split(/\s+/)
    if (!/^[0-9a-f]{40}$/.test(sha ?? '')) {
      throw new Error(`${BASELINE_PATH}: expected a 40-character sha, got "${line}"`)
    }
    return { sha, date: date ?? 'unknown', auditor: auditor ?? 'unknown' }
  }
  throw new Error(`${BASELINE_PATH}: no baseline line found`)
}

export function formatBaseline(text, entry) {
  const comments = text
    .split('\n')
    .filter((line) => line.trim() === '' || line.trim().startsWith('#'))
    .join('\n')
    .replace(/\n+$/, '')
  return `${comments}\n${entry.sha} ${entry.date} ${entry.auditor}\n`
}

export function extractHosts(grepOutput) {
  const hosts = new Set()
  for (const match of grepOutput.matchAll(/https?:\/\/([A-Za-z0-9._-]+)/g)) {
    const host = match[1].toLowerCase()
    // A single-label host is prose or an interpolated template, not a destination
    // ("https://google maps" in a comment about address-bar parsing).
    if (host.includes('.') && !IGNORED_HOSTS.test(host)) {
      hosts.add(host)
    }
  }
  return hosts
}

export function extractIpcChannels(grepOutput) {
  const channels = new Set()
  for (const match of grepOutput.matchAll(/ipcMain\.(?:handle|on)\(\s*'([^']+)'/g)) {
    channels.add(match[1])
  }
  return channels
}

// pnpm lock keys are indented `name@version:` / `/name@version:` entries. Only the
// name matters here: a version bump is routine, a package that was not in the
// graph before is a new supplier.
export function extractLockPackageNames(lockText) {
  const names = new Set()
  for (const match of lockText.matchAll(/^ {2,}'?\/?((?:@[^@/\s']+\/)?[^@/\s']+)@[^\s:']+'?:$/gm)) {
    names.add(match[1])
  }
  return names
}

export function extractDependencyNames(packageJsonText) {
  const parsed = JSON.parse(packageJsonText)
  return new Set([
    ...Object.keys(parsed.dependencies ?? {}),
    ...Object.keys(parsed.devDependencies ?? {}),
    ...Object.keys(parsed.optionalDependencies ?? {})
  ])
}

export function extractActionUses(workflowText) {
  const uses = new Set()
  for (const match of workflowText.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)/gm)) {
    uses.add(match[1].replace(/['"]/g, ''))
  }
  return uses
}

export function added(baseSet, headSet) {
  return [...headSet].filter((entry) => !baseSet.has(entry)).sort()
}

function git(args, { tolerateStatus = [] } = {}) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  } catch (error) {
    if (typeof error.status === 'number' && tolerateStatus.includes(error.status)) {
      return error.stdout ?? ''
    }
    throw error
  }
}

// git grep exits 1 on no match, which is a normal outcome here, not a failure.
function gitGrep(rev, pattern, pathspecs) {
  return git(['grep', '-h', '-I', '-o', '-E', pattern, rev, '--', ...pathspecs], {
    tolerateStatus: [1]
  })
}

function readBlob(rev, filePath) {
  return git(['show', `${rev}:${filePath}`], { tolerateStatus: [128] })
}

function readWorkflowUses(rev) {
  const listing = git(['ls-tree', '-r', '--name-only', rev, '--', '.github/workflows'], {
    tolerateStatus: [128]
  })
  const uses = new Set()
  for (const file of listing.split('\n').filter(Boolean)) {
    for (const entry of extractActionUses(readBlob(rev, file))) {
      uses.add(entry)
    }
  }
  return uses
}

function collectInventory(rev) {
  return {
    hosts: extractHosts(gitGrep(rev, 'https?://[A-Za-z0-9._-]+', SOURCE_PATHSPECS)),
    ipcChannels: extractIpcChannels(
      gitGrep(rev, "ipcMain\\.(handle|on)\\([[:space:]]*'[^']+'", ['src/main'])
    ),
    childProcessImporters: new Set(
      git(
        [
          'grep',
          '-l',
          '-E',
          "from 'node:child_process'|require\\('child_process'\\)",
          rev,
          '--',
          ...SOURCE_PATHSPECS
        ],
        { tolerateStatus: [1] }
      )
        .split('\n')
        .filter(Boolean)
        .map((line) => line.replace(`${rev}:`, ''))
    ),
    dependencies: extractDependencyNames(readBlob(rev, 'package.json')),
    lockPackages: extractLockPackageNames(readBlob(rev, 'pnpm-lock.yaml')),
    // `<path>@<blob sha>`, so a rewritten patch reads as an addition the same way
    // a brand-new one does — both need the same read.
    patches: new Set(
      git(['ls-tree', '-r', rev, '--', 'config/patches'], { tolerateStatus: [128] })
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [meta, filePath] = line.split('\t')
          return `${filePath}@${meta.split(/\s+/)[2]}`
        })
    ),
    workflowUses: readWorkflowUses(rev)
  }
}

function collectChangedFiles(baseSha, headSha) {
  const numstat = git(['diff', '--numstat', `${baseSha}..${headSha}`])
  return numstat
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [added, deleted, filePath] = line.split('\t')
      return {
        path: filePath,
        added: Number.parseInt(added, 10) || 0,
        deleted: Number.parseInt(deleted, 10) || 0,
        ...classifyPath(filePath)
      }
    })
}

export function computeSignals(baseInventory, headInventory) {
  return [
    {
      key: 'new-outbound-hosts',
      title: 'New outbound hosts',
      why: 'A destination the audited build never contacted. Confirm what it receives.',
      entries: added(baseInventory.hosts, headInventory.hosts)
    },
    {
      key: 'new-ipc-channels',
      title: 'New IPC channels',
      why: 'Renderer-reachable main-process entry points. Check argument validation and authorization.',
      entries: added(baseInventory.ipcChannels, headInventory.ipcChannels)
    },
    {
      key: 'new-child-process-importers',
      title: 'New direct child_process importers',
      why: 'Command execution outside src/shared/child-process/, which is where the argument-encoding guarantees live.',
      entries: added(baseInventory.childProcessImporters, headInventory.childProcessImporters)
    },
    {
      key: 'new-dependencies',
      title: 'New declared dependencies',
      why: 'A new supplier in the graph. Treat like a new contributor with commit access.',
      entries: added(baseInventory.dependencies, headInventory.dependencies)
    },
    {
      key: 'new-lock-packages',
      title: 'New transitive packages',
      why: 'Pulled in without a package.json change. Sample the unfamiliar ones.',
      entries: added(baseInventory.lockPackages, headInventory.lockPackages)
    },
    {
      key: 'changed-patches',
      title: 'New or rewritten third-party patches',
      why: 'A patch is arbitrary code applied to node_modules after install. Read the diff.',
      entries: added(baseInventory.patches, headInventory.patches).map((entry) =>
        entry.split('@').slice(0, -1).join('@')
      )
    },
    {
      key: 'new-action-uses',
      title: 'New CI action references',
      why: 'Anything not pinned to a full SHA can change under the tag it was pinned to.',
      entries: added(baseInventory.workflowUses, headInventory.workflowUses)
    }
  ].filter((signal) => signal.entries.length > 0)
}

export function computeVerdict(changedFiles, signals, forkContact) {
  const p0 = changedFiles.filter((file) => file.tier === 'P0')
  if (p0.length > 0 || signals.length > 0 || forkContact.length > 0) {
    return { auditRequired: true, exitCode: 1 }
  }
  return { auditRequired: false, exitCode: 0 }
}

function tierSummary(changedFiles) {
  const counts = { P0: 0, P1: 0, P2: 0 }
  for (const file of changedFiles) {
    counts[file.tier] += 1
  }
  return counts
}

function fileTable(files) {
  const rows = files.map(
    (file) => `| \`${file.path}\` | ${file.reason} | +${file.added}/-${file.deleted} |`
  )
  return ['| File | Why | Churn |', '| --- | --- | --- |', ...rows].join('\n')
}

export function buildReport({
  base,
  headRef,
  headSha,
  commitCount,
  changedFiles,
  signals,
  forkContact,
  verdict
}) {
  const counts = tierSummary(changedFiles)
  const lines = [
    '# Upstream sync gate',
    '',
    `- Baseline: \`${base.sha}\` (audited ${base.date} by ${base.auditor})`,
    `- Incoming: \`${headSha}\` (\`${headRef}\`)`,
    `- Delta: ${commitCount} commits, ${changedFiles.length} files — P0 ${counts.P0} / P1 ${counts.P1} / P2 ${counts.P2}`,
    `- Verdict: **${verdict.auditRequired ? 'audit required before merge' : 'no audit trigger'}**`,
    ''
  ]

  if (forkContact.length > 0) {
    lines.push(
      '## Fork-owned files upstream changed',
      '',
      'These carry an ERLI decision. A clean merge here can still restore a capability this build ships without — re-run the capability tests against the merged tree, and check the packaged build, not only the diff.',
      '',
      fileTable(forkContact),
      ''
    )
  }

  for (const signal of signals) {
    lines.push(
      `## ${signal.title} (${signal.entries.length})`,
      '',
      signal.why,
      '',
      ...signal.entries.map((entry) => `- \`${entry}\``),
      ''
    )
  }

  const p0 = changedFiles.filter((file) => file.tier === 'P0')
  if (p0.length > 0) {
    lines.push('## P0 — read every line', '', fileTable(p0), '')
  }

  const p1 = changedFiles.filter((file) => file.tier === 'P1')
  if (p1.length > 0) {
    lines.push('## P1 — Claude reads, a human confirms findings', '', fileTable(p1), '')
  }

  lines.push(
    `## P2 — sampled (${counts.P2} files)`,
    '',
    'Renderer, docs and tests. Skim for anything that reaches the network or the filesystem.',
    '',
    '---',
    '',
    `Round procedure and the ledger: \`${AUDIT_DOC}\`.`,
    ''
  )
  return lines.join('\n')
}

function resolveSha(rev) {
  return git(['rev-parse', '--verify', `${rev}^{commit}`]).trim()
}

export function runAuditGate(argv, { cwd = process.cwd(), today = new Date() } = {}) {
  const { values } = parseArgs({
    args: argv,
    options: {
      base: { type: 'string' },
      head: { type: 'string', default: DEFAULT_HEAD },
      report: { type: 'string' },
      'update-baseline': { type: 'boolean', default: false },
      auditor: { type: 'string' }
    }
  })

  const baselinePath = path.join(cwd, BASELINE_PATH)
  const baselineText = fs.readFileSync(baselinePath, 'utf8')
  const recorded = parseBaseline(baselineText)
  const base = values.base ? { ...recorded, sha: resolveSha(values.base) } : recorded
  const headSha = resolveSha(values.head)

  if (base.sha === headSha) {
    console.log(
      `Upstream sync gate: \`${values.head}\` is the audited baseline. Nothing to review.`
    )
    return 0
  }

  const changedFiles = collectChangedFiles(base.sha, headSha)
  const forkOwned = new Set(FORK_OWNED_PATHS)
  const forkContact = changedFiles.filter((file) => forkOwned.has(file.path))
  const signals = computeSignals(collectInventory(base.sha), collectInventory(headSha))
  const verdict = computeVerdict(changedFiles, signals, forkContact)

  const report = buildReport({
    base,
    headRef: values.head,
    headSha,
    commitCount: git(['rev-list', '--count', `${base.sha}..${headSha}`]).trim(),
    changedFiles,
    signals,
    forkContact,
    verdict
  })

  console.log(report)
  if (values.report) {
    fs.mkdirSync(path.dirname(path.resolve(cwd, values.report)), { recursive: true })
    fs.writeFileSync(path.resolve(cwd, values.report), report)
  }

  if (values['update-baseline']) {
    const entry = {
      sha: headSha,
      date: today.toISOString().slice(0, 10),
      auditor: values.auditor ?? recorded.auditor
    }
    fs.writeFileSync(baselinePath, formatBaseline(baselineText, entry))
    console.log(`\nBaseline moved to ${entry.sha}. Record the round in ${AUDIT_DOC}.`)
    return 0
  }

  return verdict.exitCode
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    process.exitCode = runAuditGate(process.argv.slice(2))
  } catch (error) {
    console.error(`Upstream sync gate failed: ${error.message}`)
    process.exitCode = 2
  }
}
