// ERLI fork regression tests for `fix(terminal): tear down failed local exits after
// input`: a failed local exit is retained (onPaneProcessDied) only for a freshly spawned
// PTY nobody typed into. Upstream retains every failed local exit; its tests asserting
// that were dropped from pty-connection-pty-exit-teardown.spec.ts and these replace them.
// Kept in their own file so the upstream suite stays byte-comparable on the next sync.
import { bindPtyConnectionTestMocks } from './pty-connection-mocks.spec'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import { sendTerminalInputThroughPane } from './pty-connection-test-dom'
import { flushAsyncTicks } from './pty-connection-test-async'
import {
  LEAF_1,
  createMockTransport,
  createPane,
  createManager,
  type ConnectCallbacks,
  type MockTransport
} from './pty-connection-test-pane-fixtures'
import { buildPaneConnectionDeps } from './pty-connection-test-deps'
import { createInitialStoreState } from './pty-connection-test-store-fixtures'
import type { StoreState } from './pty-connection-test-store-state'
import {
  installTerminalTestGlobals,
  restoreTerminalTestGlobals
} from './pty-connection-test-environment'

let mockStoreState: StoreState
let transportFactoryQueue: MockTransport[] = []
let createdTransportOptions: Record<string, unknown>[] = []
let storeSubscribers: ((state: StoreState) => void)[] = []

function createDeps(overrides: Record<string, unknown> = {}) {
  return buildPaneConnectionDeps(() => mockStoreState, overrides)
}

function installSleepingCodexResumeState(restoredPtyId?: string) {
  const paneKey = makePaneKey('tab-1', LEAF_1)
  const launchConfig = {
    agentCommand: "codex '--model' 'gpt-5'",
    agentArgs: '--model gpt-5',
    agentEnv: { CODEX_PROFILE: 'captured' }
  }
  mockStoreState = {
    ...mockStoreState,
    tabsByWorktree: {
      'wt-1': [{ id: 'tab-1', ...(restoredPtyId ? { ptyId: restoredPtyId } : {}) }]
    },
    settings: { ...mockStoreState.settings, agentCmdOverrides: {} },
    agentStatusByPaneKey: {},
    sleepingAgentSessionsByPaneKey: {
      [paneKey]: {
        paneKey,
        tabId: 'tab-1',
        worktreeId: 'wt-1',
        agent: 'codex',
        providerSession: { key: 'session_id', id: 'codex-session-1' },
        prompt: 'finish the task',
        state: 'working',
        capturedAt: 1,
        updatedAt: 1,
        launchConfig
      }
    }
  } as StoreState
  return launchConfig
}

describe('connectPanePty failed local exit (ERLI)', () => {
  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    transportFactoryQueue = []
    createdTransportOptions = []
    storeSubscribers = []
    mockStoreState = createInitialStoreState(() => mockStoreState)
    bindPtyConnectionTestMocks({
      getState: () => mockStoreState,
      getTransportQueue: () => transportFactoryQueue,
      getTransportOptions: () => createdTransportOptions,
      getStoreSubscribers: () => storeSubscribers,
      setStoreSubscribers: (subscribers) => {
        storeSubscribers = subscribers
      }
    })
    await installTerminalTestGlobals()
  })

  afterEach(async () => {
    await restoreTerminalTestGlobals()
  })

  it('tears down a failed local terminal after user input', async () => {
    // Why this inverts upstream: a shell the user typed into and that then failed is a
    // finished session, not a failed startup — retaining it strands a dead pane the exit
    // path never revisits. Only a freshly-spawned, never-typed-into PTY is retained.
    const { connectPanePty } = await import('./pty-connection')
    const pane = createPane(1)
    const transport = createMockTransport('tab-pty')
    transportFactoryQueue.push(transport)
    const manager = createManager(1)
    const deps = createDeps({ onPaneProcessDied: vi.fn() })

    connectPanePty(pane as never, manager as never, deps as never)
    const onPtySpawn = createdTransportOptions[0]?.onPtySpawn as
      | ((ptyId: string) => void)
      | undefined
    const onPtyExit = createdTransportOptions[0]?.onPtyExit as
      | ((ptyId: string, exitCode?: number) => void)
      | undefined

    onPtySpawn?.('tab-pty')
    sendTerminalInputThroughPane(pane, 'agent startup\r')
    onPtyExit?.('tab-pty', 1)

    expect(deps.onPaneProcessDied).not.toHaveBeenCalled()
    expect(deps.onPtyExitRef.current).toHaveBeenCalledWith('tab-pty', 1)
    expect(manager.closePane).not.toHaveBeenCalled()
  })

  it('keeps a freshly-spawned failed local split pane visible before input', async () => {
    const { connectPanePty } = await import('./pty-connection')
    const transport = createMockTransport('tab-pty')
    transportFactoryQueue.push(transport)
    const manager = createManager(2)
    const deps = createDeps({ onPaneProcessDied: vi.fn() })

    connectPanePty(createPane(1) as never, manager as never, deps as never)
    const onPtySpawn = createdTransportOptions[0]?.onPtySpawn as
      | ((ptyId: string) => void)
      | undefined
    const onPtyExit = createdTransportOptions[0]?.onPtyExit as
      | ((ptyId: string, exitCode?: number) => void)
      | undefined
    onPtySpawn?.('tab-pty')
    onPtyExit?.('tab-pty', 1)

    expect(deps.onPaneProcessDied).toHaveBeenCalledWith({
      paneId: 1,
      exitCode: 1,
      startup: null,
      reason: 'process-failed'
    })
    expect(manager.closePane).not.toHaveBeenCalled()
  })

  it('classifies the Git Bash capacity failure before retaining its pane', async () => {
    const { connectPanePty } = await import('./pty-connection')
    const capturedDataCallback: { current: ((data: string) => void) | null } = { current: null }
    const transport = createMockTransport('tab-pty')
    transport.connect.mockImplementation(async ({ callbacks }: { callbacks: ConnectCallbacks }) => {
      capturedDataCallback.current = callbacks.onData ?? null
      return 'tab-pty'
    })
    transportFactoryQueue.push(transport)
    const manager = createManager(1)
    const startup = { command: 'codex --resume session-1' }
    const deps = createDeps({ onPaneProcessDied: vi.fn(), startup })

    connectPanePty(createPane(1) as never, manager as never, deps as never)
    const onPtySpawn = createdTransportOptions[0]?.onPtySpawn as
      | ((ptyId: string) => void)
      | undefined
    const onPtyExit = createdTransportOptions[0]?.onPtyExit as
      | ((ptyId: string, exitCode?: number) => void)
      | undefined

    onPtySpawn?.('tab-pty')
    capturedDataCallback.current?.(
      'console device allocation failure - too many consoles in use, max consoles is 128'
    )
    onPtyExit?.('tab-pty', 1)

    expect(deps.onPaneProcessDied).toHaveBeenCalledWith({
      paneId: 1,
      exitCode: 1,
      startup,
      reason: 'git-bash-console-capacity'
    })
    expect(deps.onPtyExitRef.current).not.toHaveBeenCalled()
  })

  it('retains the cold-restore resume startup when its replacement hits capacity', async () => {
    const { connectPanePty } = await import('./pty-connection')
    const callbacks: ConnectCallbacks[] = []
    const transport = createMockTransport('resume-pty')
    transport.connect.mockImplementation(async (options: { callbacks: ConnectCallbacks }) => {
      callbacks.push(options.callbacks)
      return 'resume-pty'
    })
    transportFactoryQueue.push(transport)
    const launchConfig = installSleepingCodexResumeState()
    const deps = createDeps({
      startup: { command: 'codex stale-startup' },
      onPaneProcessDied: vi.fn()
    })

    connectPanePty(createPane(1) as never, createManager(1) as never, deps as never)
    await flushAsyncTicks(20)
    const onPtySpawn = createdTransportOptions[0]?.onPtySpawn as
      | ((ptyId: string) => void)
      | undefined
    onPtySpawn?.('resume-pty')
    callbacks[0]?.onData?.('too many consoles in use, max consoles is 128')
    const onPtyExit = createdTransportOptions[0]?.onPtyExit as
      | ((ptyId: string, exitCode?: number) => void)
      | undefined
    onPtyExit?.('resume-pty', 1)

    expect(deps.onPaneProcessDied).toHaveBeenCalledWith({
      paneId: 1,
      exitCode: 1,
      startup: expect.objectContaining({
        command: expect.stringContaining("'resume' 'codex-session-1'"),
        launchConfig,
        resumeProviderSession: { key: 'session_id', id: 'codex-session-1' },
        launchAgent: 'codex',
        showSessionRestoredBanner: true
      }),
      reason: 'git-bash-console-capacity'
    })
  })

  it('does not carry capacity detection into a cold-restore replacement', async () => {
    const { connectPanePty } = await import('./pty-connection')
    const callbacks: ConnectCallbacks[] = []
    let currentPtyId = 'lost-pty'
    const transport = createMockTransport(currentPtyId)
    transport.getPtyId.mockImplementation(() => currentPtyId)
    transport.connect.mockImplementation(
      async (options: { sessionId?: string; callbacks: ConnectCallbacks }) => {
        callbacks.push(options.callbacks)
        if (options.sessionId) {
          options.callbacks.onData?.('too many consoles in use, max consoles is 128')
          return { id: currentPtyId, sessionExpired: true }
        }
        currentPtyId = 'resume-pty'
        return currentPtyId
      }
    )
    transportFactoryQueue.push(transport)
    installSleepingCodexResumeState('lost-pty')
    const deps = createDeps({
      onPaneProcessDied: vi.fn(),
      restoredLeafId: LEAF_1,
      restoredPtyIdByLeafId: { [LEAF_1]: 'lost-pty' }
    })

    connectPanePty(createPane(1) as never, createManager(1) as never, deps as never)
    await flushAsyncTicks(30)
    expect(callbacks).toHaveLength(2)
    const onPtySpawn = createdTransportOptions[0]?.onPtySpawn as
      | ((ptyId: string) => void)
      | undefined
    onPtySpawn?.('resume-pty')
    const onPtyExit = createdTransportOptions[0]?.onPtyExit as
      | ((ptyId: string, exitCode?: number) => void)
      | undefined
    onPtyExit?.('resume-pty', 1)

    expect(deps.onPaneProcessDied).toHaveBeenCalledWith({
      paneId: 1,
      exitCode: 1,
      startup: null,
      reason: 'process-failed'
    })
  })
})
