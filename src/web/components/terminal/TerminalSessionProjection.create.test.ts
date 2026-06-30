// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createMock: vi.fn(),
  closeMock: vi.fn(),
  setBadgeMock: vi.fn(),
  estimateTerminalGeometryMock: vi.fn<() => { cols: number; rows: number } | null>(() => ({
    cols: 101,
    rows: 31,
  })),
  estimateManagedTerminalGeometryMock: vi.fn<() => { cols: number; rows: number } | null>(() => ({
    cols: 101,
    rows: 31,
  })),
  clientIdMock: vi.fn(() => 'client_local'),
}))

vi.mock('#/web/terminal.ts', () => ({
  terminalBridge: {
    create: mocks.createMock,
    close: mocks.closeMock,
    setBadge: mocks.setBadgeMock,
  },
}))

vi.mock('#/web/client-terminal-id.ts', () => ({
  readOrCreateWebTerminalClientId: mocks.clientIdMock,
}))

vi.mock('#/web/components/terminal/terminal-geometry.ts', () => ({
  DEFAULT_TERMINAL_COLS: 80,
  DEFAULT_TERMINAL_ROWS: 24,
  estimateTerminalGeometry: mocks.estimateTerminalGeometryMock,
  estimateManagedTerminalGeometry: mocks.estimateManagedTerminalGeometryMock,
}))

vi.mock('#/web/components/terminal/TerminalSession.ts', () => {
  class MockTerminalSession {
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
    focus(): void {}
    dispose(): void {}
    closeServerResourcesAndWait(): Promise<void> {
      return Promise.resolve()
    }
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
    handleIdentity(): void {}
    currentPtySessionId(): string | null {
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

  return { TerminalSession: MockTerminalSession }
})

import {
  TerminalSessionProjection,
  setTerminalSessionProjectionForTests,
} from '#/web/components/terminal/TerminalSessionProjection.ts'

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
    key: `${REPO_ROOT}\0${WORKTREE_PATH}\0session-1`,
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
        key: `${REPO_ROOT}\0${WORKTREE_PATH}\0session-1`,
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

function emitBellForKey(projection: TerminalSessionProjection, key: string): void {
  ;(projection as any).bellState.handleBell(
    {
      key,
      worktreeTerminalKey: WORKTREE_KEY,
      sessionId: 'session-1',
      index: 1,
      repoRoot: REPO_ROOT,
      branch: BRANCH,
      worktreePath: WORKTREE_PATH,
    },
    { processName: 'zsh', visible: false },
  )
}

describe('TerminalSessionProjection create flow', () => {
  let projection: TerminalSessionProjection

  beforeEach(() => {
    mocks.createMock.mockReset()
    mocks.createMock.mockResolvedValue(makeCreateResult())
    mocks.closeMock.mockReset()
    mocks.closeMock.mockResolvedValue(true)
    mocks.setBadgeMock.mockReset()
    mocks.estimateTerminalGeometryMock.mockClear()
    mocks.estimateManagedTerminalGeometryMock.mockClear()
    mocks.clientIdMock.mockClear()
    projection = new TerminalSessionProjection()
    projection.setRepoIndex(makeRepoIndex())
    setTerminalSessionProjectionForTests(projection)
    originalResizeObserver = globalThis.ResizeObserver
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      value: MockResizeObserver,
    })
    MockResizeObserver.instances = []
  })

  afterEach(() => {
    projection.destroy()
    setTerminalSessionProjectionForTests(null)
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
    projection.registerHost(WORKTREE_KEY, host)

    await projection.createTerminal({ repoRoot: REPO_ROOT, branch: BRANCH, worktreePath: WORKTREE_PATH })

    expect(mocks.estimateManagedTerminalGeometryMock).toHaveBeenCalledWith(host)
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

  test('passes a startup shell command through terminal create', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    projection.registerHost(WORKTREE_KEY, host)

    await projection.createTerminal(
      { repoRoot: REPO_ROOT, branch: BRANCH, worktreePath: WORKTREE_PATH },
      { startupShellCommand: "bat '/repo/README.md'\r" },
    )

    expect(mocks.createMock).toHaveBeenCalledWith({
      repoRoot: REPO_ROOT,
      branch: BRANCH,
      worktreePath: WORKTREE_PATH,
      kind: 'additional',
      startupShellCommand: "bat '/repo/README.md'\r",
      cols: 101,
      rows: 31,
      clientId: 'client_local',
    })
  })

  test('queues a different startup shell command behind an in-flight create for the same worktree', async () => {
    const first = Promise.withResolvers<ReturnType<typeof makeCreateResult>>()
    const secondResult = makeCreateResult({
      key: `${REPO_ROOT}\0${WORKTREE_PATH}\0session-2`,
      ptySessionId: 'pty_session_2_aaaaaaaaa',
      sessions: [
        {
          ptySessionId: 'pty_session_1_aaaaaaaaa',
          key: `${REPO_ROOT}\0${WORKTREE_PATH}\0session-1`,
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
        {
          ptySessionId: 'pty_session_2_aaaaaaaaa',
          key: `${REPO_ROOT}\0${WORKTREE_PATH}\0session-2`,
          cwd: WORKTREE_PATH,
          controller: { clientId: 'client_local', status: 'connected' as const },
          processName: 'zsh',
          canonicalTitle: null,
          phase: 'open' as const,
          message: null,
          cols: 101,
          rows: 31,
          displayOrder: 1,
        },
      ],
    })
    mocks.createMock.mockReset()
    mocks.createMock.mockReturnValueOnce(first.promise).mockResolvedValueOnce(secondResult)

    const firstCreate = projection.createTerminal(
      { repoRoot: REPO_ROOT, branch: BRANCH, worktreePath: WORKTREE_PATH },
      { startupShellCommand: "bat '/repo/a.ts'\r" },
    )
    await vi.waitFor(() => expect(mocks.createMock).toHaveBeenCalledTimes(1))

    const secondCreate = projection.createTerminal(
      { repoRoot: REPO_ROOT, branch: BRANCH, worktreePath: WORKTREE_PATH },
      { startupShellCommand: "bat '/repo/b.ts'\r" },
    )
    await Promise.resolve()
    expect(mocks.createMock).toHaveBeenCalledTimes(1)

    first.resolve(makeCreateResult())
    await expect(firstCreate).resolves.toBe(`${REPO_ROOT}\0${WORKTREE_PATH}\0session-1`)
    await vi.waitFor(() => expect(mocks.createMock).toHaveBeenCalledTimes(2))
    await expect(secondCreate).resolves.toBe(`${REPO_ROOT}\0${WORKTREE_PATH}\0session-2`)
    expect(mocks.createMock).toHaveBeenLastCalledWith({
      repoRoot: REPO_ROOT,
      branch: BRANCH,
      worktreePath: WORKTREE_PATH,
      kind: 'additional',
      startupShellCommand: "bat '/repo/b.ts'\r",
      cols: 80,
      rows: 24,
      clientId: 'client_local',
    })
  })

  test('clears the native badge when the projection starts', () => {
    expect(mocks.setBadgeMock).toHaveBeenCalledWith(0)
  })

  test('keeps the worktree pending while create is in flight with registered host geometry', async () => {
    const { promise, resolve } = Promise.withResolvers<ReturnType<typeof makeCreateResult>>()
    mocks.createMock.mockReturnValueOnce(promise)
    const host = document.createElement('div')
    document.body.appendChild(host)
    projection.registerHost(WORKTREE_KEY, host)

    const pending = projection.createTerminal({ repoRoot: REPO_ROOT, branch: BRANCH, worktreePath: WORKTREE_PATH })

    await vi.waitFor(() => expect(mocks.createMock).toHaveBeenCalledTimes(1))
    expect(projection.worktreeSnapshot(WORKTREE_KEY).pendingCreate).toBe(true)
    expect(projection.worktreeSnapshot(WORKTREE_KEY).count).toBe(0)

    resolve(makeCreateResult())
    await expect(pending).resolves.toBe(`${REPO_ROOT}\0${WORKTREE_PATH}\0session-1`)
    expect(projection.worktreeSnapshot(WORKTREE_KEY).pendingCreate).toBe(false)
    expect(projection.worktreeSnapshot(WORKTREE_KEY).count).toBe(1)
  })

  test('clears pendingCreate when create rejects', async () => {
    mocks.createMock.mockRejectedValueOnce(new Error('boom'))
    const host = document.createElement('div')
    document.body.appendChild(host)
    projection.registerHost(WORKTREE_KEY, host)

    await expect(
      projection.createTerminal({ repoRoot: REPO_ROOT, branch: BRANCH, worktreePath: WORKTREE_PATH }),
    ).rejects.toThrow('boom')
    expect(projection.worktreeSnapshot(WORKTREE_KEY).pendingCreate).toBe(false)
    expect(projection.worktreeSnapshot(WORKTREE_KEY).count).toBe(0)
  })

  test('creates with default startup geometry when no host geometry is available yet', async () => {
    const pending = projection.createTerminal({ repoRoot: REPO_ROOT, branch: BRANCH, worktreePath: WORKTREE_PATH })

    expect(projection.worktreeSnapshot(WORKTREE_KEY).pendingCreate).toBe(true)

    await expect(pending).resolves.toBe(`${REPO_ROOT}\0${WORKTREE_PATH}\0session-1`)
    expect(mocks.createMock).toHaveBeenCalledTimes(1)
    expect(mocks.createMock).toHaveBeenCalledWith({
      repoRoot: REPO_ROOT,
      branch: BRANCH,
      worktreePath: WORKTREE_PATH,
      kind: 'primary',
      cols: 80,
      rows: 24,
      clientId: 'client_local',
    })
  })

  test('pending create rejected on destroy while server create is in flight', async () => {
    const { promise } = Promise.withResolvers<ReturnType<typeof makeCreateResult>>()
    mocks.createMock.mockReturnValueOnce(promise)
    const pending = projection.createTerminal({ repoRoot: REPO_ROOT, branch: BRANCH, worktreePath: WORKTREE_PATH })

    expect(projection.worktreeSnapshot(WORKTREE_KEY).pendingCreate).toBe(true)
    expect((projection as any).pendingCreateByWorktree.size).toBe(1)
    await vi.waitFor(() => expect(mocks.createMock).toHaveBeenCalledTimes(1))

    // Attach the rejection handler before destroy() so the rejected
    // promise is not flagged as unhandled between the synchronous
    // `destroy()` call and the later `expect(...).rejects` chain.
    const expectation = expect(pending).rejects.toThrow('terminal session projection destroyed')
    projection.destroy()
    await expectation
    expect((projection as any).pendingCreateByWorktree.size).toBe(0)
    expect(projection.worktreeSnapshot(WORKTREE_KEY).pendingCreate).toBe(false)
  })

  test('closeTerminalsForWorktree waits for an in-flight create before closing it', async () => {
    const { promise, resolve } = Promise.withResolvers<ReturnType<typeof makeCreateResult>>()
    mocks.createMock.mockReturnValueOnce(promise)
    const pending = projection.createTerminal({ repoRoot: REPO_ROOT, branch: BRANCH, worktreePath: WORKTREE_PATH })

    expect(projection.worktreeSnapshot(WORKTREE_KEY).pendingCreate).toBe(true)
    await vi.waitFor(() => expect(mocks.createMock).toHaveBeenCalledTimes(1))

    const closePromise = projection.closeTerminalsForWorktree({
      repoRoot: REPO_ROOT,
      branch: BRANCH,
      worktreePath: WORKTREE_PATH,
    })
    resolve(makeCreateResult())

    await expect(pending).resolves.toBe(`${REPO_ROOT}\0${WORKTREE_PATH}\0session-1`)
    await expect(closePromise).resolves.toBe(true)
    expect((projection as any).pendingCreateByWorktree.size).toBe(0)
    expect(projection.worktreeSnapshot(WORKTREE_KEY).pendingCreate).toBe(false)
    expect(projection.worktreeSnapshot(WORKTREE_KEY).count).toBe(0)
  })

  test('closeTerminalsForWorktree returns true when no terminal sessions exist', async () => {
    expect(projection.worktreeSnapshot(WORKTREE_KEY).count).toBe(0)

    await expect(
      projection.closeTerminalsForWorktree({ repoRoot: REPO_ROOT, branch: BRANCH, worktreePath: WORKTREE_PATH }),
    ).resolves.toBe(true)

    expect(mocks.closeMock).not.toHaveBeenCalled()
  })

  test('falls back to default startup geometry when registered host geometry is unavailable', async () => {
    mocks.estimateManagedTerminalGeometryMock.mockReturnValue(null)

    const host = document.createElement('div')
    document.body.appendChild(host)
    projection.registerHost(WORKTREE_KEY, host)

    const pending = projection.createTerminal({ repoRoot: REPO_ROOT, branch: BRANCH, worktreePath: WORKTREE_PATH })

    await vi.waitFor(() => expect(mocks.createMock).toHaveBeenCalledTimes(1))
    expect(mocks.createMock).toHaveBeenCalledWith({
      repoRoot: REPO_ROOT,
      branch: BRANCH,
      worktreePath: WORKTREE_PATH,
      kind: 'primary',
      cols: 80,
      rows: 24,
      clientId: 'client_local',
    })
    expect(projection.worktreeSnapshot(WORKTREE_KEY).pendingCreate).toBe(false)
    await expect(pending).resolves.toBe(`${REPO_ROOT}\0${WORKTREE_PATH}\0session-1`)
  })

  test('creates with default startup geometry when terminal host is permanently unmeasurable', async () => {
    mocks.estimateManagedTerminalGeometryMock.mockReturnValue(null)

    const container = document.createElement('div')
    container.style.display = 'none'
    document.body.appendChild(container)
    const host = document.createElement('div')
    container.appendChild(host)
    projection.registerHost(WORKTREE_KEY, host)

    const pending = projection.createTerminal({ repoRoot: REPO_ROOT, branch: BRANCH, worktreePath: WORKTREE_PATH })

    await expect(pending).resolves.toBe(`${REPO_ROOT}\0${WORKTREE_PATH}\0session-1`)
    expect(projection.worktreeSnapshot(WORKTREE_KEY).pendingCreate).toBe(false)
    expect(mocks.createMock).toHaveBeenCalledWith({
      repoRoot: REPO_ROOT,
      branch: BRANCH,
      worktreePath: WORKTREE_PATH,
      kind: 'primary',
      cols: 80,
      rows: 24,
      clientId: 'client_local',
    })
  })

  test('durable close: awaits an in-flight close for the same worktree before creating', async () => {
    // Regression for the duplicate `Restored session:` bug: the prior
    // dispose path was fire-and-forget, so a create could race the
    // close and reattach to the orphan. The projection's durable-close
    // queue guarantees create waits for the close to settle.
    const host = document.createElement('div')
    document.body.appendChild(host)
    projection.registerHost(WORKTREE_KEY, host)

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
    const closePromise = projection.enqueueDurableClose({
      ptySessionId: 'session-stale',
      worktreeTerminalKey: WORKTREE_KEY,
    })

    // Start the create before the close settles. The promise must
    // resolve only after both have run, in the right order.
    const createPromise = projection.createTerminal({
      repoRoot: REPO_ROOT,
      branch: BRANCH,
      worktreePath: WORKTREE_PATH,
    })

    // Both promises settle eventually.
    await expect(closePromise).resolves.toBeUndefined()
    await expect(createPromise).resolves.toBe(`${REPO_ROOT}\0${WORKTREE_PATH}\0session-1`)

    // Close is awaited before create. Without the durable-close
    // guard, create would resolve first because the close promise
    // was launched with `void`.
    expect(callOrder).toEqual(['close', 'create'])

    // The pending entry is cleaned up after the close settles.
    expect((projection as any).pendingCloseByPtySessionId.size).toBe(0)
  })

  test('durable close: failures do not block the next create', async () => {
    // The flush-and-proceed seam: a stuck close (e.g., socket
    // already closing) must not strand the user. The create still
    // runs; the failure is already logged inside performDurableClose.
    const host = document.createElement('div')
    document.body.appendChild(host)
    projection.registerHost(WORKTREE_KEY, host)

    mocks.closeMock.mockRejectedValueOnce(new Error('Terminal socket closed'))

    const closePromise = projection.enqueueDurableClose({
      ptySessionId: 'session-stale',
      worktreeTerminalKey: WORKTREE_KEY,
    })

    await expect(closePromise).rejects.toThrow('Terminal socket closed')
    expect((projection as any).pendingCloseByPtySessionId.size).toBe(0)

    // The next create proceeds normally.
    await expect(
      projection.createTerminal({ repoRoot: REPO_ROOT, branch: BRANCH, worktreePath: WORKTREE_PATH }),
    ).resolves.toBe(`${REPO_ROOT}\0${WORKTREE_PATH}\0session-1`)
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

    const first = projection.enqueueDurableClose({
      ptySessionId: 'session-stale',
      worktreeTerminalKey: WORKTREE_KEY,
    })
    const second = projection.enqueueDurableClose({
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

    const closePromise = projection.enqueueDurableClose({
      ptySessionId: 'session-stale',
      worktreeTerminalKey: WORKTREE_KEY,
    })

    expect((projection as any).pendingCloseByPtySessionId.size).toBe(1)
    projection.destroy()
    await expect(closePromise).rejects.toThrow('terminal session projection destroyed')
    expect((projection as any).pendingCloseByPtySessionId.size).toBe(0)
  })

  test('durable close: handleSessionClosed drops the matching local session', async () => {
    // The server emits a session-closed broadcast when window A
    // closes a session. Sibling windows route the event into
    // handleSessionClosed to drop the local entry without a
    // full reconcile.
    const host = document.createElement('div')
    document.body.appendChild(host)
    projection.registerHost(WORKTREE_KEY, host)
    await projection.createTerminal({ repoRoot: REPO_ROOT, branch: BRANCH, worktreePath: WORKTREE_PATH })

    expect(projection.worktreeSnapshot(WORKTREE_KEY).sessions.length).toBe(1)

    projection.handleSessionClosed('pty_session_1_aaaaaaaaa')

    // The local session is gone; the worktree snapshot is empty.
    expect(projection.worktreeSnapshot(WORKTREE_KEY).sessions.length).toBe(0)
  })

  test('prunes sessions missing from the repo index and clears their bell badge', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    projection.registerHost(WORKTREE_KEY, host)
    const key = await projection.createTerminal({ repoRoot: REPO_ROOT, branch: BRANCH, worktreePath: WORKTREE_PATH })
    mocks.setBadgeMock.mockClear()
    ;(projection as any).bellState.handleBell(
      {
        key,
        worktreeTerminalKey: WORKTREE_KEY,
        sessionId: 'session-1',
        index: 1,
        repoRoot: REPO_ROOT,
        branch: BRANCH,
        worktreePath: WORKTREE_PATH,
      },
      { processName: 'zsh', visible: false },
    )
    expect(mocks.setBadgeMock).toHaveBeenLastCalledWith(1)

    projection.setRepoIndex({})

    expect(projection.worktreeSnapshot(WORKTREE_KEY).sessions.length).toBe(0)
    expect(mocks.setBadgeMock).toHaveBeenLastCalledWith(0)
  })

  test('publishes repo bell counts through repo listeners', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    projection.registerHost(WORKTREE_KEY, host)
    const listener = vi.fn()
    const unsubscribe = projection.subscribeRepoBellCount(REPO_ROOT, listener)

    try {
      const key = await projection.createTerminal({ repoRoot: REPO_ROOT, branch: BRANCH, worktreePath: WORKTREE_PATH })
      expect(projection.repoBellCount(REPO_ROOT)).toBe(0)
      expect(listener).not.toHaveBeenCalled()

      emitBellForKey(projection, key)

      expect(projection.repoBellCount(REPO_ROOT)).toBe(1)
      expect(listener).toHaveBeenCalledTimes(1)

      listener.mockClear()
      projection.scrollToBottom(key)

      expect(projection.repoBellCount(REPO_ROOT)).toBe(1)
      expect(listener).not.toHaveBeenCalled()

      listener.mockClear()
      projection.clearBell(key)

      expect(projection.repoBellCount(REPO_ROOT)).toBe(0)
      expect(listener).toHaveBeenCalledTimes(1)
    } finally {
      unsubscribe()
    }
  })

  test('publishes repo bell count changes when a bell session is removed', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    projection.registerHost(WORKTREE_KEY, host)
    const key = await projection.createTerminal({ repoRoot: REPO_ROOT, branch: BRANCH, worktreePath: WORKTREE_PATH })
    emitBellForKey(projection, key)

    const listener = vi.fn()
    const unsubscribe = projection.subscribeRepoBellCount(REPO_ROOT, listener)

    try {
      expect(projection.repoBellCount(REPO_ROOT)).toBe(1)

      projection.handleSessionClosed('pty_session_1_aaaaaaaaa')

      expect(projection.repoBellCount(REPO_ROOT)).toBe(0)
      expect(listener).toHaveBeenCalledTimes(1)
    } finally {
      unsubscribe()
    }
  })

  test('does not prune sessions when the repo still exists but branch metadata is temporarily missing', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    projection.registerHost(WORKTREE_KEY, host)
    await projection.createTerminal({ repoRoot: REPO_ROOT, branch: BRANCH, worktreePath: WORKTREE_PATH })

    projection.setRepoIndex({
      [REPO_ROOT]: {
        instanceToken: 2,
        branchByWorktreePath: {},
      },
    })

    expect(projection.worktreeSnapshot(WORKTREE_KEY).sessions.length).toBe(1)
  })
})
