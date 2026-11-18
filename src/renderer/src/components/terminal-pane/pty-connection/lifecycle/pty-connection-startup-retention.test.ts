// ERLI fork regression tests for `fix(terminal): tear down failed local exits after
// input`. A tab's sole pane keeps a dead terminal only when it was freshly spawned and
// nobody typed into it; a shell the user typed into is a finished session and closes.
// Kept in their own file so the upstream teardown suite stays byte-comparable on a sync.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bindPtyConnectionTestMocks } from '../test-fixtures/pty-connection-mocks.spec'
import { sendTerminalInputThroughPane } from '../test-fixtures/pty-connection-test-dom'
import {
  createMockTransport,
  createPane,
  createManager,
  type MockTransport
} from '../test-fixtures/pty-connection-test-pane-fixtures'
import { buildPaneConnectionDeps } from '../test-fixtures/pty-connection-test-deps'
import { createInitialStoreState } from '../test-fixtures/pty-connection-test-store-fixtures'
import type { StoreState } from '../test-fixtures/pty-connection-test-store-state'
import {
  installTerminalTestGlobals,
  restoreTerminalTestGlobals
} from '../test-fixtures/pty-connection-test-environment'

let mockStoreState: StoreState
let transportFactoryQueue: MockTransport[] = []
let createdTransportOptions: Record<string, unknown>[] = []
let storeSubscribers: ((state: StoreState) => void)[] = []

type PtyCallbacks = {
  onPtySpawn: (ptyId: string) => void
  onPtyExit: (ptyId: string, exitCode?: number) => void
}

function createDeps(overrides: Record<string, unknown> = {}) {
  return buildPaneConnectionDeps(() => mockStoreState, overrides)
}

/** Reports driving input the way the IPC transport does: on send, before the write is acknowledged. */
function reportDrivingInputOnSend(transport: MockTransport, ack: () => Promise<boolean>): void {
  transport.sendInputAccepted?.mockImplementation((_data: string, inputKind?: string) => {
    if (inputKind === 'driving') {
      const report = createdTransportOptions[0]?.onDrivingInputAttempt as
        | ((ptyId: string | null) => void)
        | undefined
      report?.(transport.getPtyId())
    }
    return ack()
  })
}

async function connectSolePane(transport: MockTransport) {
  const { connectPanePty } = await import('../connect-pane-pty')
  const pane = createPane(1)
  transportFactoryQueue.push(transport)
  const manager = createManager(1)
  const deps = createDeps()
  connectPanePty(pane as never, manager as never, deps as never)
  const callbacks = createdTransportOptions[0] as unknown as PtyCallbacks
  return { pane, manager, deps, callbacks }
}

describe('connectPanePty startup retention (ERLI)', () => {
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

  it('tears down a failed local terminal after acknowledged user input', async () => {
    const transport = createMockTransport('tab-pty')
    const { pane, manager, deps, callbacks } = await connectSolePane(transport)

    callbacks.onPtySpawn('tab-pty')
    sendTerminalInputThroughPane(pane, 'agent startup\r')
    await Promise.resolve()
    callbacks.onPtyExit('tab-pty', 1)

    expect(deps.onPtyExitRef.current).toHaveBeenCalledWith('tab-pty', 1)
    expect(manager.closePane).not.toHaveBeenCalled()
  })

  it('tears down when the exit races the acknowledgement of an interrupt', async () => {
    const transport = createMockTransport('tab-pty')
    reportDrivingInputOnSend(transport, () => new Promise<boolean>(() => {}))
    const { pane, deps, callbacks } = await connectSolePane(transport)

    callbacks.onPtySpawn('tab-pty')
    sendTerminalInputThroughPane(pane, '\u0003')
    callbacks.onPtyExit('tab-pty', 1)

    expect(deps.onPtyExitRef.current).toHaveBeenCalledWith('tab-pty', 1)
  })

  it('keeps an untouched fresh PTY that fails', async () => {
    const transport = createMockTransport('tab-pty')
    const { deps, callbacks } = await connectSolePane(transport)

    callbacks.onPtySpawn('tab-pty')
    callbacks.onPtyExit('tab-pty', 1)

    expect(deps.onPtyExitRef.current).not.toHaveBeenCalled()
  })

  it('does not credit a previous PTY input to a replacement fresh PTY', async () => {
    const transport = createMockTransport('first-pty')
    const { pane, deps, callbacks } = await connectSolePane(transport)

    callbacks.onPtySpawn('first-pty')
    sendTerminalInputThroughPane(pane, 'prior session input\r')
    await Promise.resolve()
    transport.getPtyId.mockReturnValue('replacement-pty')
    callbacks.onPtySpawn('replacement-pty')
    callbacks.onPtyExit('replacement-pty', 1)

    expect(deps.onPtyExitRef.current).not.toHaveBeenCalled()
  })
})
