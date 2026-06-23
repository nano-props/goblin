// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createMock: vi.fn(),
  closeMock: vi.fn(),
  proposeTerminalGeometryMock: vi.fn<() => { cols: number; rows: number } | null>(() => ({
    cols: 101,
    rows: 31,
  })),
  preloadTerminalFontMock: vi.fn(async () => {}),
  attachmentIdMock: vi.fn(() => 'client_local'),
}))

vi.mock('#/web/terminal.ts', () => ({
  terminalBridge: {
    create: mocks.createMock,
    close: mocks.closeMock,
    setBadge: vi.fn(),
  },
}))

vi.mock('#/web/renderer-terminal-bridge.ts', () => ({
  readOrCreateWebTerminalClientId: mocks.attachmentIdMock,
}))

vi.mock('#/web/components/terminal/terminal-geometry.ts', () => ({
  DEFAULT_TERMINAL_COLS: 80,
  DEFAULT_TERMINAL_ROWS: 24,
  preloadTerminalFont: mocks.preloadTerminalFontMock,
  proposeTerminalGeometry: mocks.proposeTerminalGeometryMock,
}))

vi.mock('#/web/components/terminal/ManagedTerminalSlot.ts', () => {
  class MockManagedTerminalSession {
    descriptor: any
    private ptySessionId: string | null = null
    private snapshotState: any = { phase: 'opening', message: null, processName: 'terminal', canonicalTitle: null }
    private serializeValue = ''

    constructor(descriptor: any) {
      this.descriptor = descriptor
    }

    updateDescriptor(descriptor: any): void {
      this.descriptor = descriptor
    }

    attach(): void {}
    detach(): void {}
    restart(): void {}
    dispose(): void {}
    isTerminalFocusTarget(): boolean {
      return false
    }
    findNext() {
      return { resultIndex: -1, resultCount: 0, found: false }
    }
    findPrevious() {
      return { resultIndex: -1, resultCount: 0, found: false }
    }
    clearSearch(): void {}
    scrollToBottom(): void {}
    scrollLines(): void {}
    writeInput(): void {}
    takeover(): Promise<boolean> {
      return Promise.resolve(true)
    }
    serialize(): string {
      return this.serializeValue
    }
    handleOutput(): void {}
    handleServerTitle(): void {}
    handleExit(): boolean {
      return false
    }
    handleOwnership(): void {}
    currentSessionId(): string | null {
      return this.ptySessionId
    }
    snapshot() {
      return this.snapshotState
    }
    hydrate(input: any): void {
      this.ptySessionId = input.ptySessionId
      this.serializeValue = input.snapshot ?? this.serializeValue
      this.snapshotState = {
        phase: 'open',
        message: null,
        processName: input.processName,
        canonicalTitle: input.canonicalTitle,
        attachment: {
          role: input.role,
          controllerStatus: input.controllerStatus,
          active: input.role === 'controller',
          canTakeover: input.role !== 'controller',
          canonicalCols: input.canonicalCols,
          canonicalRows: input.canonicalRows,
        },
      }
    }
  }

  return { ManagedTerminalSession: MockManagedTerminalSession }
})

import {
  TerminalSlotRegistry,
  setTerminalSlotRegistryForTests,
} from '#/web/components/terminal/TerminalSlotRegistry.ts'

const REPO_ROOT = '/repo'
const WORKTREE_PATH = '/repo'
const BRANCH = 'main'
const WORKTREE_KEY = `${REPO_ROOT}\0${WORKTREE_PATH}`

class MockResizeObserver {
  static instances: MockResizeObserver[] = []
  observe = vi.fn()
  disconnect = vi.fn()
  unobserve = vi.fn()
  private readonly callback: () => void
  constructor(callback: () => void) {
    this.callback = callback
    MockResizeObserver.instances.push(this)
  }
  trigger(): void {
    this.callback()
  }
}

let originalResizeObserver: typeof ResizeObserver | undefined

function makeRepoIndex() {
  return {
    [REPO_ROOT]: {
      instanceToken: 1,
      branchByWorktreePath: { [WORKTREE_PATH]: BRANCH },
    },
  }
}

function makeCreateResult(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ok: true as const,
    action: 'created' as const,
    key: `${REPO_ROOT}\0${WORKTREE_PATH}\0slot-1`,
    ptySessionId: 'pty_session_1_aaaaaaaaa',
    processName: 'zsh',
    canonicalTitle: null,
    phase: 'open' as const,
    message: null,
    snapshot: '',
    snapshotSeq: 0,
    controller: { clientId: 'client_local', status: 'connected' as const },
    canonicalCols: 101,
    canonicalRows: 31,
    sessions: [
      {
        ptySessionId: 'pty_session_1_aaaaaaaaa',
        key: `${REPO_ROOT}\0${WORKTREE_PATH}\0slot-1`,
        cwd: WORKTREE_PATH,
        controller: { clientId: 'client_local', status: 'connected' as const },
        processName: 'zsh',
        canonicalTitle: null,
        phase: 'open' as const,
        message: null,
        cols: 101,
        rows: 31,
        displayOrder: 0,
      },
    ],
    ...overrides,
  }
}

describe('TerminalSlotRegistry create flow', () => {
  let registry: TerminalSlotRegistry

  beforeEach(() => {
    mocks.createMock.mockReset()
    mocks.createMock.mockResolvedValue(makeCreateResult())
    mocks.closeMock.mockReset()
    mocks.closeMock.mockResolvedValue(true)
    mocks.proposeTerminalGeometryMock.mockClear()
    mocks.preloadTerminalFontMock.mockClear()
    mocks.attachmentIdMock.mockClear()
    registry = new TerminalSlotRegistry(() => REPO_ROOT)
    registry.setRepoIndex(makeRepoIndex())
    setTerminalSlotRegistryForTests(registry)
    originalResizeObserver = globalThis.ResizeObserver
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      value: MockResizeObserver,
    })
    MockResizeObserver.instances = []
  })

  afterEach(() => {
    registry.destroy()
    setTerminalSlotRegistryForTests(null)
    document.body.innerHTML = ''
    if (originalResizeObserver) {
      Object.defineProperty(globalThis, 'ResizeObserver', {
        configurable: true,
        value: originalResizeObserver,
      })
    } else {
      delete (globalThis as any).ResizeObserver
    }
    MockResizeObserver.instances = []
  })

  test('creates a terminal with the registered host geometry', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    registry.registerHost(WORKTREE_KEY, host)

    await registry.createTerminal({ repoRoot: REPO_ROOT, branch: BRANCH, worktreePath: WORKTREE_PATH })

    expect(mocks.preloadTerminalFontMock).toHaveBeenCalled()
    expect(mocks.proposeTerminalGeometryMock).toHaveBeenCalledWith(host)
    expect(mocks.createMock).toHaveBeenCalledWith({
      repoRoot: REPO_ROOT,
      branch: BRANCH,
      worktreePath: WORKTREE_PATH,
      kind: 'primary',
      cols: 101,
      rows: 31,
      clientId: 'client_local',
    })
  })

  test('keeps the worktree pending while create is in flight with registered host geometry', async () => {
    const { promise, resolve } = Promise.withResolvers<ReturnType<typeof makeCreateResult>>()
    mocks.createMock.mockReturnValueOnce(promise)
    const host = document.createElement('div')
    document.body.appendChild(host)
    registry.registerHost(WORKTREE_KEY, host)

    const pending = registry.createTerminal({ repoRoot: REPO_ROOT, branch: BRANCH, worktreePath: WORKTREE_PATH })

    await vi.waitFor(() => expect(mocks.createMock).toHaveBeenCalledTimes(1))
    expect(registry.worktreeSnapshot(WORKTREE_KEY).pendingCreate).toBe(true)
    expect(registry.worktreeSnapshot(WORKTREE_KEY).count).toBe(0)

    resolve(makeCreateResult())
    await expect(pending).resolves.toBe(`${REPO_ROOT}\0${WORKTREE_PATH}\0slot-1`)
    expect(registry.worktreeSnapshot(WORKTREE_KEY).pendingCreate).toBe(false)
    expect(registry.worktreeSnapshot(WORKTREE_KEY).count).toBe(1)
  })

  test('clears pendingCreate when create rejects', async () => {
    mocks.createMock.mockRejectedValueOnce(new Error('boom'))
    const host = document.createElement('div')
    document.body.appendChild(host)
    registry.registerHost(WORKTREE_KEY, host)

    await expect(
      registry.createTerminal({ repoRoot: REPO_ROOT, branch: BRANCH, worktreePath: WORKTREE_PATH }),
    ).rejects.toThrow('boom')
    expect(registry.worktreeSnapshot(WORKTREE_KEY).pendingCreate).toBe(false)
    expect(registry.worktreeSnapshot(WORKTREE_KEY).count).toBe(0)
  })

  test('waits for host registration before creating when no geometry is available yet', async () => {
    const pending = registry.createTerminal({ repoRoot: REPO_ROOT, branch: BRANCH, worktreePath: WORKTREE_PATH })

    expect(registry.worktreeSnapshot(WORKTREE_KEY).pendingCreate).toBe(true)
    expect(mocks.createMock).not.toHaveBeenCalled()

    const host = document.createElement('div')
    document.body.appendChild(host)
    registry.registerHost(WORKTREE_KEY, host)

    await expect(pending).resolves.toBe(`${REPO_ROOT}\0${WORKTREE_PATH}\0slot-1`)
    expect(mocks.createMock).toHaveBeenCalledTimes(1)
    expect(mocks.createMock).toHaveBeenCalledWith({
      repoRoot: REPO_ROOT,
      branch: BRANCH,
      worktreePath: WORKTREE_PATH,
      kind: 'primary',
      cols: 101,
      rows: 31,
      clientId: 'client_local',
    })
  })

  test('pending create rejected on destroy while waiting for host registration', async () => {
    const pending = registry.createTerminal({ repoRoot: REPO_ROOT, branch: BRANCH, worktreePath: WORKTREE_PATH })

    expect(registry.worktreeSnapshot(WORKTREE_KEY).pendingCreate).toBe(true)
    expect((registry as any).pendingCreateByWorktree.size).toBe(1)
    // The waiter is registered only after the flush reaches
    // `waitForHostRegistration` — that's several await boundaries past
    // the synchronous `enqueuePendingCreate`, so we must wait for it.
    await vi.waitFor(() => expect((registry as any).hostWaitersByWorktree.size).toBe(1))

    // Attach the rejection handler before destroy() so the rejected
    // promise is not flagged as unhandled between the synchronous
    // `destroy()` call and the later `expect(...).rejects` chain.
    const expectation = expect(pending).rejects.toThrow('terminal registry destroyed')
    registry.destroy()
    await expectation
    expect((registry as any).hostWaitersByWorktree.size).toBe(0)
    expect((registry as any).pendingCreateByWorktree.size).toBe(0)
    expect(registry.worktreeSnapshot(WORKTREE_KEY).pendingCreate).toBe(false)
  })

  test('retries creating until host geometry becomes measurable', async () => {
    mocks.proposeTerminalGeometryMock.mockReturnValue(null)

    const host = document.createElement('div')
    document.body.appendChild(host)
    registry.registerHost(WORKTREE_KEY, host)

    const pending = registry.createTerminal({ repoRoot: REPO_ROOT, branch: BRANCH, worktreePath: WORKTREE_PATH })

    await vi.waitFor(() => expect(MockResizeObserver.instances).toHaveLength(1))
    const observer = MockResizeObserver.instances[0]!
    observer.trigger()
    expect(mocks.createMock).not.toHaveBeenCalled()

    mocks.proposeTerminalGeometryMock.mockReturnValue({ cols: 101, rows: 31 })
    observer.trigger()

    await vi.waitFor(() => expect(mocks.createMock).toHaveBeenCalledTimes(1))
    expect(registry.worktreeSnapshot(WORKTREE_KEY).pendingCreate).toBe(false)
    await expect(pending).resolves.toBe(`${REPO_ROOT}\0${WORKTREE_PATH}\0terminal-1`)
  })

  test('fails create when terminal host is permanently unmeasurable', async () => {
    mocks.proposeTerminalGeometryMock.mockReturnValue(null)

    const container = document.createElement('div')
    container.style.display = 'none'
    document.body.appendChild(container)
    const host = document.createElement('div')
    container.appendChild(host)
    registry.registerHost(WORKTREE_KEY, host)

    const pending = registry.createTerminal({ repoRoot: REPO_ROOT, branch: BRANCH, worktreePath: WORKTREE_PATH })

    await expect(pending).rejects.toThrow('host is inside a display:none subtree')
    expect(registry.worktreeSnapshot(WORKTREE_KEY).pendingCreate).toBe(false)
    expect(mocks.createMock).not.toHaveBeenCalled()
  })

  test('durable close: awaits an in-flight close for the same worktree before creating', async () => {
    // Regression for the duplicate `Restored session:` bug: the prior
    // dispose path was fire-and-forget, so a create could race the
    // close and reattach to the orphan. The registry's durable-close
    // queue guarantees create waits for the close to settle.
    const host = document.createElement('div')
    document.body.appendChild(host)
    registry.registerHost(WORKTREE_KEY, host)

    // Order closeMock to record its call order relative to createMock.
    const callOrder: string[] = []
    mocks.closeMock.mockImplementation(async () => {
      callOrder.push('close')
      return true
    })
    mocks.createMock.mockImplementation(async () => {
      callOrder.push('create')
      return makeCreateResult()
    })

    // Enqueue a durable close and DO NOT await it. The next
    // createTerminal must wait for the close to settle before
    // issuing its own create call.
    const closePromise = registry.enqueueDurableClose({
      ptySessionId: 'session-stale',
      worktreeTerminalKey: WORKTREE_KEY,
    })

    // Start the create before the close settles. The promise must
    // resolve only after both have run, in the right order.
    const createPromise = registry.createTerminal({
      repoRoot: REPO_ROOT,
      branch: BRANCH,
      worktreePath: WORKTREE_PATH,
    })

    // Both promises settle eventually.
    await expect(closePromise).resolves.toBeUndefined()
    await expect(createPromise).resolves.toBe(`${REPO_ROOT}\0${WORKTREE_PATH}\0slot-1`)

    // Close is awaited before create. Without the durable-close
    // guard, create would resolve first because the close promise
    // was launched with `void`.
    expect(callOrder).toEqual(['close', 'create'])

    // The pending entry is cleaned up after the close settles.
    expect((registry as any).pendingCloseBySessionId.size).toBe(0)
  })

  test('durable close: failures do not block the next create', async () => {
    // The flush-and-proceed seam: a stuck close (e.g., socket
    // already closing) must not strand the user. The create still
    // runs; the failure is already logged inside performDurableClose.
    const host = document.createElement('div')
    document.body.appendChild(host)
    registry.registerHost(WORKTREE_KEY, host)

    mocks.closeMock.mockRejectedValueOnce(new Error('Terminal socket closed'))

    const closePromise = registry.enqueueDurableClose({
      ptySessionId: 'session-stale',
      worktreeTerminalKey: WORKTREE_KEY,
    })

    await expect(closePromise).rejects.toThrow('Terminal socket closed')
    expect((registry as any).pendingCloseBySessionId.size).toBe(0)

    // The next create proceeds normally.
    await expect(
      registry.createTerminal({ repoRoot: REPO_ROOT, branch: BRANCH, worktreePath: WORKTREE_PATH }),
    ).resolves.toBe(`${REPO_ROOT}\0${WORKTREE_PATH}\0slot-1`)
    expect(mocks.createMock).toHaveBeenCalledTimes(1)
  })

  test('durable close: deduplicates concurrent enqueues for the same session', async () => {
    // The catalog may surface a session-closed event AND a parallel
    // dispose() call for the same ptySessionId. The first call owns the
    // request; the second observes the same outcome.
    let resolveClose!: (value: boolean) => void
    mocks.closeMock.mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        resolveClose = resolve
      }),
    )

    const first = registry.enqueueDurableClose({
      ptySessionId: 'session-stale',
      worktreeTerminalKey: WORKTREE_KEY,
    })
    const second = registry.enqueueDurableClose({
      ptySessionId: 'session-stale',
      worktreeTerminalKey: WORKTREE_KEY,
    })

    // Only one close call was dispatched.
    expect(mocks.closeMock).toHaveBeenCalledTimes(1)
    expect(mocks.closeMock).toHaveBeenCalledWith({ ptySessionId: 'session-stale' })

    resolveClose(true)
    await expect(first).resolves.toBeUndefined()
    await expect(second).resolves.toBeUndefined()
  })

  test('durable close: destroys reject pending entries', async () => {
    // The pending-close map mirrors the pending-create map: on
    // destroy, every entry rejects so callers awaiting it can clean
    // up. The mock `close` is left hanging so the entry is still
    // pending when destroy runs.
    mocks.closeMock.mockReturnValueOnce(new Promise<boolean>(() => {}))

    const closePromise = registry.enqueueDurableClose({
      ptySessionId: 'session-stale',
      worktreeTerminalKey: WORKTREE_KEY,
    })

    expect((registry as any).pendingCloseBySessionId.size).toBe(1)
    registry.destroy()
    await expect(closePromise).rejects.toThrow('terminal registry destroyed')
    expect((registry as any).pendingCloseBySessionId.size).toBe(0)
  })

  test('durable close: handleSlotClosed drops the matching local session', async () => {
    // The server emits a session-closed broadcast when window A
    // closes a session. Sibling windows route the event into
    // handleSlotClosed to drop the local entry without a
    // full reconcile.
    const host = document.createElement('div')
    document.body.appendChild(host)
    registry.registerHost(WORKTREE_KEY, host)
    await registry.createTerminal({ repoRoot: REPO_ROOT, branch: BRANCH, worktreePath: WORKTREE_PATH })

    expect(registry.worktreeSnapshot(WORKTREE_KEY).sessions.length).toBe(1)

    registry.handleSlotClosed('pty_session_1_aaaaaaaaa')

    // The local session is gone; the worktree snapshot is empty.
    expect(registry.worktreeSnapshot(WORKTREE_KEY).sessions.length).toBe(0)
  })

})
