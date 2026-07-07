// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createMock: vi.fn(),
  closeMock: vi.fn(),
  listWorkspaceTabsMock: vi.fn(),
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

const REPO_INSTANCE_ID = 'repo-instance-test'

vi.mock('#/web/terminal.ts', () => ({
  terminalClient: {
    create: mocks.createMock,
    close: mocks.closeMock,
    listWorkspaceTabs: mocks.listWorkspaceTabsMock,
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
    private terminalRuntimeSessionId: string | null = null
    private snapshotState: any = { phase: 'opening', message: null, processName: 'terminal', canonicalTitle: null }

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
    handleOutput(): void {}
    handleServerTitle(): void {}
    handleExit(): boolean {
      return false
    }
    handleIdentity(): void {}
    currentTerminalRuntimeSessionId(): string | null {
      return this.terminalRuntimeSessionId
    }
    snapshot() {
      return this.snapshotState
    }
    hydrate(input: any): void {
      this.terminalRuntimeSessionId = input.terminalRuntimeSessionId
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
import {
  clearWorkspacePaneTabsOperationQueuesForTests,
  runWorkspacePaneTabsOperation,
} from '#/web/workspace-pane/workspace-pane-tabs-operation-queue.ts'

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
      instanceId: REPO_INSTANCE_ID,
      branchByWorktreePath: { [WORKTREE_PATH]: BRANCH },
    },
  }
}

function terminalBase() {
  return {
    repoRoot: REPO_ROOT,
    repoInstanceId: REPO_INSTANCE_ID,
    branch: BRANCH,
    worktreePath: WORKTREE_PATH,
  }
}

function makeCreateResult(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ok: true as const,
    action: 'created' as const,
    terminalSessionId: 'session-1',
    tabs: [],
    terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
    processName: 'zsh',
    canonicalTitle: null,
    phase: 'open' as const,
    message: null,
    snapshot: '',
    snapshotSeq: 0,
    outputEra: 0,
    controller: { clientId: 'client_local', status: 'connected' as const },
    canonicalCols: 101,
    canonicalRows: 31,
    sessions: [
      {
        terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
        terminalSessionId: 'session-1',
        repoRoot: REPO_ROOT,
        worktreePath: WORKTREE_PATH,
        cwd: WORKTREE_PATH,
        controller: { clientId: 'client_local', status: 'connected' as const },
        processName: 'zsh',
        canonicalTitle: null,
        phase: 'open' as const,
        message: null,
        cols: 101,
        rows: 31,
      },
    ],
    ...overrides,
  }
}

function emitBellForKey(projection: TerminalSessionProjection, terminalSessionId: string): void {
  ;(projection as any).bellState.handleBell(
    {
      terminalSessionId,
      terminalWorktreeKey: WORKTREE_KEY,
      index: 1,
      repoRoot: REPO_ROOT,
      branch: BRANCH,
      worktreePath: WORKTREE_PATH,
    },
    { processName: 'zsh', visible: false },
  )
}

function durableCloseInput() {
  return {
    terminalRuntimeSessionId: 'session-stale',
    terminalWorktreeKey: WORKTREE_KEY,
  }
}

function workspacePaneTabsOperationTarget() {
  return {
    repoRoot: REPO_ROOT,
    repoInstanceId: REPO_INSTANCE_ID,
    branchName: BRANCH,
    worktreePath: WORKTREE_PATH,
  }
}

describe('TerminalSessionProjection create flow', () => {
  let projection: TerminalSessionProjection

  beforeEach(() => {
    clearWorkspacePaneTabsOperationQueuesForTests()
    mocks.createMock.mockReset()
    mocks.createMock.mockResolvedValue(makeCreateResult())
    mocks.closeMock.mockReset()
    mocks.closeMock.mockResolvedValue(true)
    mocks.listWorkspaceTabsMock.mockReset()
    mocks.listWorkspaceTabsMock.mockResolvedValue([])
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
    clearWorkspacePaneTabsOperationQueuesForTests()
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

    await projection.createTerminal(terminalBase())

    expect(mocks.estimateManagedTerminalGeometryMock).toHaveBeenCalledWith(host)
    expect(mocks.createMock).toHaveBeenCalledWith({
      repoRoot: REPO_ROOT,
      repoInstanceId: REPO_INSTANCE_ID,
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

    await projection.createTerminal(terminalBase(), { startupShellCommand: "bat '/repo/README.md'\r" })

    expect(mocks.createMock).toHaveBeenCalledWith({
      repoRoot: REPO_ROOT,
      repoInstanceId: REPO_INSTANCE_ID,
      branch: BRANCH,
      worktreePath: WORKTREE_PATH,
      kind: 'additional',
      startupShellCommand: "bat '/repo/README.md'\r",
      cols: 101,
      rows: 31,
      clientId: 'client_local',
    })
  })

  test('marks create pending before resolving an async startup shell command', async () => {
    const startupCommand = Promise.withResolvers<string>()
    const create = projection.createTerminal(terminalBase(), {
      resolveStartupShellCommand: async () => await startupCommand.promise,
    })

    await vi.waitFor(() => {
      expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).createPending).toBe(true)
    })
    expect(mocks.createMock).not.toHaveBeenCalled()

    startupCommand.resolve("bat '/repo/README.md'\r")
    await vi.waitFor(() => expect(mocks.createMock).toHaveBeenCalledTimes(1))

    await expect(create).resolves.toBe('session-1')
    expect(mocks.createMock).toHaveBeenCalledWith({
      repoRoot: REPO_ROOT,
      repoInstanceId: REPO_INSTANCE_ID,
      branch: BRANCH,
      worktreePath: WORKTREE_PATH,
      kind: 'additional',
      startupShellCommand: "bat '/repo/README.md'\r",
      cols: 80,
      rows: 24,
      clientId: 'client_local',
    })
  })

  test('closeTerminalsForWorktree cancels create while async startup shell command is resolving', async () => {
    const startupCommand = Promise.withResolvers<string>()
    const create = projection.createTerminal(terminalBase(), {
      resolveStartupShellCommand: async () => await startupCommand.promise,
    })

    await vi.waitFor(() => {
      expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).createPending).toBe(true)
    })
    const createExpectation = expect(create).rejects.toThrow('terminal create request canceled')
    const closePromise = projection.closeTerminalsForWorktree(terminalBase())

    await createExpectation
    await expect(closePromise).resolves.toBe(true)

    startupCommand.resolve("bat '/repo/README.md'\r")
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(mocks.createMock).not.toHaveBeenCalled()
    expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).createPending).toBe(false)
  })

  test('destroy cancels create while async startup shell command is resolving', async () => {
    const startupCommand = Promise.withResolvers<string>()
    const create = projection.createTerminal(terminalBase(), {
      resolveStartupShellCommand: async () => await startupCommand.promise,
    })

    await vi.waitFor(() => {
      expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).createPending).toBe(true)
    })
    const createExpectation = expect(create).rejects.toThrow('terminal session projection destroyed')
    projection.destroy()
    await createExpectation

    startupCommand.resolve("bat '/repo/README.md'\r")
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(mocks.createMock).not.toHaveBeenCalled()
    expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).createPending).toBe(false)
  })

  test('deduplicates identical in-flight creates for the same worktree', async () => {
    const first = Promise.withResolvers<ReturnType<typeof makeCreateResult>>()
    mocks.createMock.mockReset()
    mocks.createMock.mockReturnValueOnce(first.promise)

    const base = terminalBase()
    const options = { startupShellCommand: "bat '/repo/a.ts'\r" }

    const firstCreate = projection.createTerminal(base, options)
    await vi.waitFor(() => expect(mocks.createMock).toHaveBeenCalledTimes(1))

    const secondCreate = projection.createTerminal(base, { ...options })

    expect(secondCreate).toBe(firstCreate)
    expect(mocks.createMock).toHaveBeenCalledTimes(1)

    first.resolve(makeCreateResult())
    await expect(firstCreate).resolves.toBe('session-1')
    await expect(secondCreate).resolves.toBe('session-1')
    expect(mocks.createMock).toHaveBeenCalledTimes(1)
  })

  test('queues a different startup shell command behind an in-flight create for the same worktree', async () => {
    const first = Promise.withResolvers<ReturnType<typeof makeCreateResult>>()
    const secondResult = makeCreateResult({
      terminalSessionId: 'session-2',
      terminalRuntimeSessionId: 'pty_session_2_aaaaaaaaa',
      sessions: [
        {
          terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
          terminalSessionId: 'session-1',
          repoRoot: REPO_ROOT,
          worktreePath: WORKTREE_PATH,
          cwd: WORKTREE_PATH,
          controller: { clientId: 'client_local', status: 'connected' as const },
          processName: 'zsh',
          canonicalTitle: null,
          phase: 'open' as const,
          message: null,
          cols: 101,
          rows: 31,
        },
        {
          terminalRuntimeSessionId: 'pty_session_2_aaaaaaaaa',
          terminalSessionId: 'session-2',
          repoRoot: REPO_ROOT,
          worktreePath: WORKTREE_PATH,
          cwd: WORKTREE_PATH,
          controller: { clientId: 'client_local', status: 'connected' as const },
          processName: 'zsh',
          canonicalTitle: null,
          phase: 'open' as const,
          message: null,
          cols: 101,
          rows: 31,
        },
      ],
    })
    mocks.createMock.mockReset()
    mocks.createMock.mockReturnValueOnce(first.promise).mockResolvedValueOnce(secondResult)

    const firstCreate = projection.createTerminal(terminalBase(), { startupShellCommand: "bat '/repo/a.ts'\r" })
    await vi.waitFor(() => expect(mocks.createMock).toHaveBeenCalledTimes(1))

    const secondCreate = projection.createTerminal(terminalBase(), { startupShellCommand: "bat '/repo/b.ts'\r" })
    await Promise.resolve()
    expect(mocks.createMock).toHaveBeenCalledTimes(1)

    first.resolve(makeCreateResult())
    await expect(firstCreate).resolves.toBe('session-1')
    await vi.waitFor(() => expect(mocks.createMock).toHaveBeenCalledTimes(2))
    await expect(secondCreate).resolves.toBe('session-2')
    expect(mocks.createMock).toHaveBeenLastCalledWith({
      repoRoot: REPO_ROOT,
      repoInstanceId: REPO_INSTANCE_ID,
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

    const pending = projection.createTerminal(terminalBase())

    await vi.waitFor(() => expect(mocks.createMock).toHaveBeenCalledTimes(1))
    expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).createPending).toBe(true)
    expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).count).toBe(0)

    resolve(makeCreateResult())
    await expect(pending).resolves.toBe('session-1')
    expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).createPending).toBe(false)
    expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).count).toBe(1)
  })

  test('clears createPending when create rejects', async () => {
    mocks.createMock.mockRejectedValueOnce(new Error('boom'))
    const host = document.createElement('div')
    document.body.appendChild(host)
    projection.registerHost(WORKTREE_KEY, host)

    await expect(projection.createTerminal(terminalBase())).rejects.toThrow('boom')
    expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).createPending).toBe(false)
    expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).count).toBe(0)
  })

  test('owned create closes the server session and skips local projection when the owner turns stale', async () => {
    let fresh = true
    const create = Promise.withResolvers<ReturnType<typeof makeCreateResult>>()
    mocks.createMock.mockReturnValueOnce(create.promise)

    const pending = projection.createOwnedTerminal(terminalBase(), {
      key: 'repo-instance-1',
      isFresh: () => fresh,
    })
    await vi.waitFor(() => expect(mocks.createMock).toHaveBeenCalledTimes(1))
    fresh = false
    create.resolve(makeCreateResult())

    await expect(pending).rejects.toThrow('terminal create request canceled')

    expect(mocks.closeMock).toHaveBeenCalledWith({ terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa' })
    expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).count).toBe(0)
    expect(projection.snapshot('session-1').phase).toBe('opening')
  })

  test('owned create closes the server session when the owner turns stale during tabs projection write', async () => {
    projection.destroy()
    let fresh = true
    const tabsWrite = Promise.withResolvers<void>()
    const onWorkspaceTabsChanged = vi.fn(async () => {
      await tabsWrite.promise
    })
    projection = new TerminalSessionProjection(() => {}, onWorkspaceTabsChanged)
    projection.setRepoIndex(makeRepoIndex())

    const pending = projection.createOwnedTerminal(terminalBase(), {
      key: 'repo-instance-1',
      isFresh: () => fresh,
    })

    await vi.waitFor(() => expect(onWorkspaceTabsChanged).toHaveBeenCalledTimes(1))
    fresh = false
    tabsWrite.resolve()

    await expect(pending).rejects.toThrow('terminal create request canceled')
    expect(mocks.closeMock).toHaveBeenCalledWith({ terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa' })
    expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).count).toBe(0)
  })

  test('owned creates queue distinct user actions instead of deduping them', async () => {
    const first = Promise.withResolvers<ReturnType<typeof makeCreateResult>>()
    const secondResult = makeCreateResult({
      terminalSessionId: 'session-2',
      terminalRuntimeSessionId: 'pty_session_2_aaaaaaaaa',
      sessions: [
        {
          terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
          terminalSessionId: 'session-1',
          repoRoot: REPO_ROOT,
          worktreePath: WORKTREE_PATH,
          cwd: WORKTREE_PATH,
          controller: { clientId: 'client_local', status: 'connected' as const },
          processName: 'zsh',
          canonicalTitle: null,
          phase: 'open' as const,
          message: null,
          cols: 101,
          rows: 31,
        },
        {
          terminalRuntimeSessionId: 'pty_session_2_aaaaaaaaa',
          terminalSessionId: 'session-2',
          repoRoot: REPO_ROOT,
          worktreePath: WORKTREE_PATH,
          cwd: WORKTREE_PATH,
          controller: { clientId: 'client_local', status: 'connected' as const },
          processName: 'zsh',
          canonicalTitle: null,
          phase: 'open' as const,
          message: null,
          cols: 101,
          rows: 31,
        },
      ],
    })
    mocks.createMock.mockReset()
    mocks.createMock.mockReturnValueOnce(first.promise).mockResolvedValueOnce(secondResult)

    const owner = {
      key: 'repo-instance-1',
      isFresh: () => true,
    }

    const firstCreate = projection.createOwnedTerminal(terminalBase(), owner)
    await vi.waitFor(() => expect(mocks.createMock).toHaveBeenCalledTimes(1))

    const secondCreate = projection.createOwnedTerminal(terminalBase(), owner)
    expect(secondCreate).not.toBe(firstCreate)
    await Promise.resolve()
    expect(mocks.createMock).toHaveBeenCalledTimes(1)

    first.resolve(makeCreateResult())
    await expect(firstCreate).resolves.toBe('session-1')
    await vi.waitFor(() => expect(mocks.createMock).toHaveBeenCalledTimes(2))
    await expect(secondCreate).resolves.toBe('session-2')
  })

  test('creates with default startup geometry when no host geometry is available yet', async () => {
    const pending = projection.createTerminal(terminalBase())

    expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).createPending).toBe(true)

    await expect(pending).resolves.toBe('session-1')
    expect(mocks.createMock).toHaveBeenCalledTimes(1)
    expect(mocks.createMock).toHaveBeenCalledWith({
      repoRoot: REPO_ROOT,
      repoInstanceId: REPO_INSTANCE_ID,
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
    const pending = projection.createTerminal(terminalBase())

    expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).createPending).toBe(true)
    expect((projection as any).lifecycleQueues.hasCreate(WORKTREE_KEY)).toBe(true)
    await vi.waitFor(() => expect(mocks.createMock).toHaveBeenCalledTimes(1))

    // Attach the rejection handler before destroy() so the rejected
    // promise is not flagged as unhandled between the synchronous
    // `destroy()` call and the later `expect(...).rejects` chain.
    const expectation = expect(pending).rejects.toThrow('terminal session projection destroyed')
    projection.destroy()
    await expectation
    expect((projection as any).lifecycleQueues.hasCreate(WORKTREE_KEY)).toBe(false)
    expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).createPending).toBe(false)
  })

  test('destroy disposes a server create result that resolves after the queue entry is gone', async () => {
    const { promise, resolve } = Promise.withResolvers<ReturnType<typeof makeCreateResult>>()
    mocks.createMock.mockReturnValueOnce(promise)
    const pending = projection.createTerminal(terminalBase())

    await vi.waitFor(() => expect(mocks.createMock).toHaveBeenCalledTimes(1))
    const expectation = expect(pending).rejects.toThrow('terminal session projection destroyed')
    projection.destroy()
    await expectation

    resolve(makeCreateResult())
    await vi.waitFor(() => {
      expect(mocks.closeMock).toHaveBeenCalledWith({ terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa' })
    })
  })

  test('closeTerminalsForWorktree waits for an in-flight create before closing it', async () => {
    const { promise, resolve } = Promise.withResolvers<ReturnType<typeof makeCreateResult>>()
    mocks.createMock.mockReturnValueOnce(promise)
    const pending = projection.createTerminal(terminalBase())

    expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).createPending).toBe(true)
    await vi.waitFor(() => expect(mocks.createMock).toHaveBeenCalledTimes(1))

    const closePromise = projection.closeTerminalsForWorktree(terminalBase())
    resolve(makeCreateResult())

    await expect(pending).resolves.toBe('session-1')
    await expect(closePromise).resolves.toBe(true)
    expect((projection as any).lifecycleQueues.hasCreate(WORKTREE_KEY)).toBe(false)
    expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).createPending).toBe(false)
    expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).count).toBe(0)
  })

  test('closeTerminalsForWorktree returns true when no terminal sessions exist', async () => {
    expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).count).toBe(0)

    await expect(projection.closeTerminalsForWorktree(terminalBase())).resolves.toBe(true)

    expect(mocks.closeMock).not.toHaveBeenCalled()
  })

  test('falls back to default startup geometry when registered host geometry is unavailable', async () => {
    mocks.estimateManagedTerminalGeometryMock.mockReturnValue(null)

    const host = document.createElement('div')
    document.body.appendChild(host)
    projection.registerHost(WORKTREE_KEY, host)

    const pending = projection.createTerminal(terminalBase())

    await vi.waitFor(() => expect(mocks.createMock).toHaveBeenCalledTimes(1))
    expect(mocks.createMock).toHaveBeenCalledWith({
      repoRoot: REPO_ROOT,
      repoInstanceId: REPO_INSTANCE_ID,
      branch: BRANCH,
      worktreePath: WORKTREE_PATH,
      kind: 'primary',
      cols: 80,
      rows: 24,
      clientId: 'client_local',
    })
    expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).createPending).toBe(false)
    await expect(pending).resolves.toBe('session-1')
  })

  test('creates with default startup geometry when terminal host is permanently unmeasurable', async () => {
    mocks.estimateManagedTerminalGeometryMock.mockReturnValue(null)

    const container = document.createElement('div')
    container.style.display = 'none'
    document.body.appendChild(container)
    const host = document.createElement('div')
    container.appendChild(host)
    projection.registerHost(WORKTREE_KEY, host)

    const pending = projection.createTerminal(terminalBase())

    await expect(pending).resolves.toBe('session-1')
    expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).createPending).toBe(false)
    expect(mocks.createMock).toHaveBeenCalledWith({
      repoRoot: REPO_ROOT,
      repoInstanceId: REPO_INSTANCE_ID,
      branch: BRANCH,
      worktreePath: WORKTREE_PATH,
      kind: 'primary',
      cols: 80,
      rows: 24,
      clientId: 'client_local',
    })
  })

  test('waits for workspace pane tabs projection write before resolving create', async () => {
    projection.destroy()
    const tabsWrite = Promise.withResolvers<void>()
    const onWorkspaceTabsChanged = vi.fn(async () => {
      await tabsWrite.promise
    })
    projection = new TerminalSessionProjection(() => {}, onWorkspaceTabsChanged)
    projection.setRepoIndex(makeRepoIndex())

    const pending = projection.createTerminal(terminalBase())
    let settled = false
    void pending.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      },
    )

    await vi.waitFor(() => expect(onWorkspaceTabsChanged).toHaveBeenCalledTimes(1))
    await Promise.resolve()
    expect(settled).toBe(false)

    tabsWrite.resolve()
    await expect(pending).resolves.toBe('session-1')
    expect(settled).toBe(true)
  })

  test('canceling create during async startup resolution releases the workspace pane tab queue', async () => {
    const startup = Promise.withResolvers<string>()
    const createPromise = projection
      .createTerminal(terminalBase(), {
        resolveStartupShellCommand: async () => await startup.promise,
      })
      .catch((error) => {
        if (error instanceof Error) return error.message
        throw error
      })

    await vi.waitFor(() => expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).createPending).toBe(true))

    await expect(projection.closeTerminalsForWorktree(terminalBase())).resolves.toBe(true)
    await expect(createPromise).resolves.toBe('terminal create request canceled')

    await expect(runWorkspacePaneTabsOperation(workspacePaneTabsOperationTarget(), async () => 'released')).resolves.toBe(
      'released',
    )
    expect(mocks.createMock).not.toHaveBeenCalled()
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
      ...durableCloseInput(),
    })

    // Start the create before the close settles. The promise must
    // resolve only after both have run, in the right order.
    const createPromise = projection.createTerminal(terminalBase())

    // Both promises settle eventually.
    await expect(closePromise).resolves.toBeUndefined()
    await expect(createPromise).resolves.toBe('session-1')

    // Close is awaited before create. Without the durable-close
    // guard, create would resolve first because the close promise
    // was launched with `void`.
    expect(callOrder).toEqual(['close', 'create'])

    // The pending entry is cleaned up after the close settles.
    expect((projection as any).lifecycleQueues.hasCloses()).toBe(false)
  })

  test('durable close: failures do not block the next create', async () => {
    // The flush-and-proceed seam: a stuck close (e.g., socket
    // already closing) must not strand the user. The create still
    // runs; the failure is already logged inside performDurableClose.
    const host = document.createElement('div')
    document.body.appendChild(host)
    projection.registerHost(WORKTREE_KEY, host)

    const callOrder: string[] = []
    const close = Promise.withResolvers<boolean>()
    mocks.closeMock.mockImplementationOnce(async () => {
      callOrder.push('close')
      return await close.promise
    })
    mocks.createMock.mockImplementationOnce(async () => {
      callOrder.push('create')
      return makeCreateResult()
    })

    const closePromise = projection.enqueueDurableClose({
      ...durableCloseInput(),
    })

    const createPromise = projection.createTerminal(terminalBase())

    await Promise.resolve()
    expect(mocks.createMock).not.toHaveBeenCalled()

    close.reject(new Error('Terminal socket closed'))

    await expect(closePromise).rejects.toThrow('Terminal socket closed')
    await expect(createPromise).resolves.toBe('session-1')
    expect(mocks.createMock).toHaveBeenCalledTimes(1)
    expect(callOrder).toEqual(['close', 'create'])
    expect((projection as any).lifecycleQueues.hasCloses()).toBe(false)
  })

  test('durable close: deduplicates concurrent enqueues for the same session', async () => {
    // The session service may surface a session-closed event AND a parallel
    // dispose() call for the same terminalRuntimeSessionId. The first call owns the
    // request; the second observes the same outcome.
    let resolveClose!: (value: boolean) => void
    mocks.closeMock.mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        resolveClose = resolve
      }),
    )

    const first = projection.enqueueDurableClose({
      ...durableCloseInput(),
    })
    const second = projection.enqueueDurableClose({
      ...durableCloseInput(),
    })

    // Only one close call was dispatched.
    expect(mocks.closeMock).toHaveBeenCalledTimes(1)
    expect(mocks.closeMock).toHaveBeenCalledWith({ terminalRuntimeSessionId: 'session-stale' })

    resolveClose(true)
    await expect(first).resolves.toBeUndefined()
    await expect(second).resolves.toBeUndefined()
  })

  test('durable close: destroys reject pending entries', async () => {
    // The pending-close map mirrors the pending-create map: on
    // destroy, every entry rejects so callers awaiting it can clean
    // up. The mock `close` is left hanging so the entry is still
    // pending when destroy runs.
    let resolveClose!: (value: boolean) => void
    mocks.closeMock.mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        resolveClose = resolve
      }),
    )

    const closePromise = projection.enqueueDurableClose({
      ...durableCloseInput(),
    })

    expect((projection as any).lifecycleQueues.hasCloses()).toBe(true)
    projection.destroy()
    await expect(closePromise).rejects.toThrow('terminal session projection destroyed')
    expect((projection as any).lifecycleQueues.hasCloses()).toBe(false)
    resolveClose(true)
    await vi.waitFor(() => expect(mocks.closeMock).toHaveBeenCalledWith({ terminalRuntimeSessionId: 'session-stale' }))
  })

  test('durable close: handleSessionClosed drops the matching local session', async () => {
    // The server emits a session-closed broadcast when window A
    // closes a session. Sibling windows route the event into
    // handleSessionClosed to drop the local entry without a
    // full reconcile.
    const host = document.createElement('div')
    document.body.appendChild(host)
    projection.registerHost(WORKTREE_KEY, host)
    await projection.createTerminal(terminalBase())

    expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).sessions.length).toBe(1)

    projection.handleSessionClosed({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalSessionId: 'session-1',
    })

    // The local session is gone; the worktree snapshot is empty.
    expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).sessions.length).toBe(0)
  })

  test('durable close: handleSessionClosed falls back to terminalSessionId when the pty index misses', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    projection.registerHost(WORKTREE_KEY, host)
    await projection.createTerminal(terminalBase())

    expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).sessions.length).toBe(1)

    projection.handleSessionClosed({
      terminalRuntimeSessionId: 'pty_session_missing_aaaaaaaaa',
      terminalSessionId: 'session-1',
    })

    expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).sessions.length).toBe(0)
  })

  test('caps pending server bells for unknown sessions', () => {
    for (let index = 0; index < 100; index += 1) {
      projection.handleServerBell({
        terminalRuntimeSessionId: `pty_session_${index}_aaaaaaaaa`,
        terminalSessionId: `session-${index}`,
        repoRoot: REPO_ROOT,
        worktreePath: WORKTREE_PATH,
        processName: 'zsh',
        canonicalTitle: null,
      })
    }

    const pendingBells = (projection as any).pendingServerBellByTerminalSessionId as Map<string, unknown>
    expect(pendingBells.size).toBe(99)
    expect(pendingBells.has('session-0')).toBe(false)
    expect(pendingBells.has('session-99')).toBe(true)
  })

  test('clears pending server bell when an unknown session is closed', () => {
    projection.handleServerBell({
      terminalRuntimeSessionId: 'pty_session_unknown_aaaaaaaaa',
      terminalSessionId: 'session-unknown',
      repoRoot: REPO_ROOT,
      worktreePath: WORKTREE_PATH,
      processName: 'zsh',
      canonicalTitle: null,
    })

    const pendingBells = (projection as any).pendingServerBellByTerminalSessionId as Map<string, unknown>
    expect(pendingBells.has('session-unknown')).toBe(true)

    projection.handleSessionClosed({
      terminalRuntimeSessionId: 'pty_session_unknown_aaaaaaaaa',
      terminalSessionId: 'session-unknown',
    })

    expect(pendingBells.has('session-unknown')).toBe(false)
  })

  test('prunes sessions missing from the repo index and clears their bell badge', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    projection.registerHost(WORKTREE_KEY, host)
    const terminalSessionId = await projection.createTerminal(terminalBase())
    mocks.setBadgeMock.mockClear()
    ;(projection as any).bellState.handleBell(
      {
        terminalSessionId,
        terminalWorktreeKey: WORKTREE_KEY,
        index: 1,
        repoRoot: REPO_ROOT,
        branch: BRANCH,
        worktreePath: WORKTREE_PATH,
      },
      { processName: 'zsh', visible: false },
    )
    expect(mocks.setBadgeMock).toHaveBeenLastCalledWith(1)

    projection.setRepoIndex({})

    expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).sessions.length).toBe(0)
    expect(mocks.setBadgeMock).toHaveBeenLastCalledWith(0)
  })

  test('publishes repo bell counts through repo listeners', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    projection.registerHost(WORKTREE_KEY, host)
    const listener = vi.fn()
    const unsubscribe = projection.subscribeRepoBellCount(REPO_ROOT, listener)

    try {
      const terminalSessionId = await projection.createTerminal(terminalBase())
      expect(projection.repoBellCount(REPO_ROOT)).toBe(0)
      expect(listener).not.toHaveBeenCalled()

      emitBellForKey(projection, terminalSessionId)

      expect(projection.repoBellCount(REPO_ROOT)).toBe(1)
      expect(listener).toHaveBeenCalledTimes(1)

      listener.mockClear()
      projection.scrollToBottom(terminalSessionId)

      expect(projection.repoBellCount(REPO_ROOT)).toBe(1)
      expect(listener).not.toHaveBeenCalled()

      listener.mockClear()
      projection.clearBell(terminalSessionId)

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
    const terminalSessionId = await projection.createTerminal(terminalBase())
    emitBellForKey(projection, terminalSessionId)

    const listener = vi.fn()
    const unsubscribe = projection.subscribeRepoBellCount(REPO_ROOT, listener)

    try {
      expect(projection.repoBellCount(REPO_ROOT)).toBe(1)

      projection.handleSessionClosed({ terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa', terminalSessionId })

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
    await projection.createTerminal(terminalBase())

    projection.setRepoIndex({
      [REPO_ROOT]: {
        instanceId: 'repo-instance-test-2',
        branchByWorktreePath: {},
      },
    })

    expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).sessions.length).toBe(1)
  })
})
