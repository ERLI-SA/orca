// ERLI fork regression tests for `fix(terminal): tear down failed local exits after
// input`. Kept in their own file so the upstream teardown suite stays byte-comparable
// on a sync, and so neither file has to carry a max-lines suppression.
import type * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendTerminalInputThroughPane } from './pty-connection-test-dom'
import {
  createMockTransport,
  createPane,
  createManager,
  type MockTransport
} from './pty-connection-test-pane-fixtures'
import { buildPaneConnectionDeps } from './pty-connection-test-deps'
import { createInitialStoreState } from './pty-connection-test-store-fixtures'
import type { StoreState } from './pty-connection-test-store-state'
import {
  installTerminalTestGlobals,
  restoreTerminalTestGlobals
} from './pty-connection-test-environment'

const {
  resetAndRefreshAllTerminalWebglAtlases,
  scheduleTerminalWebglAtlasRecovery,
  scheduleRuntimeGraphSync,
  shouldSeedCacheTimerOnInitialTitle,
  toastInfo,
  notifyCodexPaneBoundForStaleSweep
} = vi.hoisted(() => ({
  resetAndRefreshAllTerminalWebglAtlases: vi.fn(),
  scheduleTerminalWebglAtlasRecovery: vi.fn(),
  scheduleRuntimeGraphSync: vi.fn(),
  shouldSeedCacheTimerOnInitialTitle: vi.fn(() => false),
  toastInfo: vi.fn(),
  notifyCodexPaneBoundForStaleSweep: vi.fn()
}))

let mockStoreState: StoreState
let transportFactoryQueue: MockTransport[] = []
let createdTransportOptions: Record<string, unknown>[] = []
let storeSubscribers: ((state: StoreState) => void)[] = []

vi.mock('@/runtime/sync-runtime-graph', () => ({
  scheduleRuntimeGraphSync
}))

vi.mock('@/lib/pane-manager/pane-manager-registry', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resetAndRefreshAllTerminalWebglAtlases
}))

vi.mock('./terminal-webgl-atlas-recovery', () => ({
  scheduleTerminalWebglAtlasRecovery
}))

vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => mockStoreState,
    subscribe: (listener: (state: StoreState) => void) => {
      storeSubscribers.push(listener)
      return () => {
        storeSubscribers = storeSubscribers.filter((candidate) => candidate !== listener)
      }
    }
  }
}))

vi.mock('@/lib/agent-status', async (importOriginal) => {
  const { buildAgentStatusModuleMock } = await import('./pty-connection-test-environment')
  return buildAgentStatusModuleMock(await importOriginal<Record<string, unknown>>())
})

vi.mock('./cache-timer-seeding', () => ({
  shouldSeedCacheTimerOnInitialTitle
}))

vi.mock('sonner', () => ({
  toast: {
    info: toastInfo
  }
}))

vi.mock('@/lib/codex-stale-pane-sweep', () => ({
  notifyCodexPaneBoundForStaleSweep
}))

// Why: the working→idle test invokes the real useNotificationDispatch hook outside React, so useCallback must pass through (safe suite-wide: no test here renders React).
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof React>()
  return {
    ...actual,
    useCallback: <T extends (...args: unknown[]) => unknown>(fn: T): T => fn
  }
})

vi.mock('./pty-transport', () => ({
  createIpcPtyTransport: vi.fn((options: Record<string, unknown>) => {
    createdTransportOptions.push(options)
    const nextTransport = transportFactoryQueue.shift()
    if (!nextTransport) {
      throw new Error('No mock transport queued')
    }
    return nextTransport
  })
}))

vi.mock('./remote-runtime-pty-transport', () => ({
  createRemoteRuntimePtyTransport: vi.fn(
    (_environmentId: string, options: Record<string, unknown>) => {
      createdTransportOptions.push(options)
      const nextTransport = transportFactoryQueue.shift()
      if (!nextTransport) {
        throw new Error('No mock transport queued')
      }
      return nextTransport
    }
  )
}))

// Why: stub only getEagerPtyBufferHandle so tests can simulate a live eager buffer (adopt path) without standing up the real IPC dispatcher.
vi.mock('./pty-dispatcher', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    getEagerPtyBufferHandle: vi.fn(() => undefined)
  }
})

function createDeps(overrides: Record<string, unknown> = {}) {
  return buildPaneConnectionDeps(() => mockStoreState, overrides)
}

describe('connectPanePty startup retention', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    transportFactoryQueue = []
    createdTransportOptions = []
    storeSubscribers = []
    mockStoreState = createInitialStoreState(() => mockStoreState)
    installTerminalTestGlobals()
  })

  afterEach(async () => {
    await restoreTerminalTestGlobals()
  })

  it('does not classify an interrupt as startup failure when exit races its write acknowledgement', async () => {
    const { connectPanePty } = await import('./pty-connection')
    const pane = createPane(1)
    const transport = createMockTransport('tab-pty')
    transport.sendInputAccepted?.mockImplementation(() => new Promise<boolean>(() => {}))
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
    sendTerminalInputThroughPane(pane, '\u0003')
    onPtyExit?.('tab-pty', 1)

    expect(deps.onPaneProcessDied).not.toHaveBeenCalled()
    expect(deps.onPtyExitRef.current).toHaveBeenCalledWith('tab-pty', 1)
    expect(manager.closePane).not.toHaveBeenCalled()
  })

  it('resets startup-retention input state for a replacement fresh PTY', async () => {
    const { connectPanePty } = await import('./pty-connection')
    const pane = createPane(1)
    const transport = createMockTransport('first-pty')
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

    onPtySpawn?.('first-pty')
    sendTerminalInputThroughPane(pane, 'prior session input\r')
    transport.getPtyId.mockReturnValue('replacement-pty')
    onPtySpawn?.('replacement-pty')
    onPtyExit?.('replacement-pty', 1)

    expect(deps.onPaneProcessDied).toHaveBeenCalledWith({
      paneId: 1,
      exitCode: 1,
      startup: null,
      reason: 'process-failed'
    })
    expect(deps.onPtyExitRef.current).not.toHaveBeenCalled()
    expect(manager.closePane).not.toHaveBeenCalled()
  })

  it('ignores a prior PTY write acknowledgement after a replacement fresh spawn', async () => {
    const { connectPanePty } = await import('./pty-connection')
    const pane = createPane(1)
    const transport = createMockTransport('first-pty')
    let settleWrite: ((accepted: boolean) => void) | undefined
    transport.sendInputAccepted?.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          settleWrite = resolve
        })
    )
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

    onPtySpawn?.('first-pty')
    sendTerminalInputThroughPane(pane, '\u0003')
    transport.getPtyId.mockReturnValue('replacement-pty')
    onPtySpawn?.('replacement-pty')
    settleWrite?.(true)
    await Promise.resolve()
    onPtyExit?.('replacement-pty', 1)

    expect(deps.onPaneProcessDied).toHaveBeenCalledWith({
      paneId: 1,
      exitCode: 1,
      startup: null,
      reason: 'process-failed'
    })
    expect(deps.onPtyExitRef.current).not.toHaveBeenCalled()
    expect(manager.closePane).not.toHaveBeenCalled()
  })
})
