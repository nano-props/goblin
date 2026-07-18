// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { TerminalCreateResult } from '#/shared/terminal-types.ts'
import { runtimeWorkspacePaneTargetForTest } from '#/web/test-utils/workspace-pane-tabs.ts'

const mocks = vi.hoisted(() => ({
  createMock: vi.fn(),
  openRuntimeMock: vi.fn(),
  closeRuntimeMock: vi.fn(),
  writeWorkspaceTabsSnapshotMock: vi.fn(),
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

const WORKSPACE_RUNTIME_ID = 'repo-runtime-test'

vi.mock('#/web/terminal.ts', () => ({
  terminalClient: {
    close: mocks.closeMock,
    listWorkspaceTabs: mocks.listWorkspaceTabsMock,
    setBadge: mocks.setBadgeMock,
  },
}))

vi.mock('#/web/workspace-pane/workspace-pane-runtime-client.ts', () => ({
  workspacePaneRuntimeClient: {
    open: mocks.openRuntimeMock,
    close: mocks.closeRuntimeMock,
  },
}))

vi.mock('#/web/workspace-pane/workspace-pane-tabs-commit.ts', () => ({
  writeCanonicalWorkspacePaneTabsSnapshot: mocks.writeWorkspaceTabsSnapshotMock,
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
    private readonly notify: () => void
    private terminalRuntimeSessionId: string | null = null
    private terminalRuntimeGeneration: number | null = null
    private snapshotState: any = { phase: 'opening', message: null, processName: 'terminal', canonicalTitle: null }

    constructor(descriptor: any, notify: () => void) {
      this.descriptor = descriptor
      this.notify = notify
    }

    updateDescriptor(descriptor: any): void {
      this.descriptor = descriptor
    }

    attach(): void {}
    detach(): void {}
    restart(): void {}
    focus(): void {}
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
    handleOutput(): void {}
    handleServerTitle(): void {}
    handleExit(): boolean {
      return false
    }
    handleIdentity(): void {}
    currentTerminalRuntimeSessionId(): string | null {
      return this.terminalRuntimeSessionId
    }
    currentRuntimeBinding() {
      return this.terminalRuntimeSessionId && this.terminalRuntimeGeneration !== null
        ? {
            terminalRuntimeSessionId: this.terminalRuntimeSessionId,
            terminalRuntimeGeneration: this.terminalRuntimeGeneration,
          }
        : null
    }
    addressableRuntimeBinding() {
      return this.currentRuntimeBinding()
    }
    pendingAuthoritativeRuntimeBinding() {
      return null
    }
    commitPendingAuthoritativeHydration(): boolean {
      return false
    }
    classifyRuntimeBinding(binding: { terminalRuntimeSessionId: string; terminalRuntimeGeneration: number }) {
      const current = this.currentRuntimeBinding()
      if (!current) return 'future'
      if (
        current.terminalRuntimeSessionId === binding.terminalRuntimeSessionId &&
        current.terminalRuntimeGeneration === binding.terminalRuntimeGeneration
      )
        return 'active'
      if (
        current.terminalRuntimeSessionId === binding.terminalRuntimeSessionId &&
        binding.terminalRuntimeGeneration > current.terminalRuntimeGeneration
      )
        return 'future'
      return 'foreign'
    }
    isVisible(): boolean {
      return false
    }
    snapshot() {
      return this.snapshotState
    }
    hydrate(input: any): void {
      this.terminalRuntimeSessionId = input.terminalRuntimeSessionId
      this.terminalRuntimeGeneration = input.terminalRuntimeGeneration
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
      this.notify()
    }
  }

  return { TerminalSession: MockTerminalSession }
})

import {
  TerminalSessionProjection,
  setTerminalSessionProjectionForTests,
} from '#/web/components/terminal/TerminalSessionProjection.ts'

const REPO_ROOT = 'goblin+file:///repo'
const WORKTREE_PATH = '/repo'
const BRANCH = 'main'
const WORKTREE_KEY = `${REPO_ROOT}\0${REPO_ROOT}`

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

function makeRuntimeMembershipIndex() {
  return {
    [REPO_ROOT]: {
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
    },
  }
}

function terminalBase() {
  const target = runtimeWorkspacePaneTargetForTest({
    kind: 'git-worktree' as const,
    workspaceId: REPO_ROOT,
    workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
    worktreePath: WORKTREE_PATH,
  })
  if (target.kind !== 'git-worktree') throw new Error('expected git worktree target')
  return {
    target,
    presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: BRANCH } },
  }
}

type TerminalCreateSuccess = Extract<TerminalCreateResult, { ok: true }>

function makeCreateResult(overrides: Partial<TerminalCreateSuccess> = {}): TerminalCreateSuccess {
  return {
    ok: true as const,
    action: 'created' as const,
    presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: BRANCH } },
    terminalSessionId: 'term-111111111111111111111',
    terminalProjectionEffect: { kind: 'delta', revision: 11 },
    terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
    terminalRuntimeGeneration: 1,
    processName: 'zsh',
    canonicalTitle: null,
    phase: 'open' as const,
    message: null,
    controller: { clientId: 'client_local', status: 'connected' as const },
    canonicalCols: 101,
    canonicalRows: 31,
    ...overrides,
  }
}

function emitBellForKey(projection: TerminalSessionProjection, terminalSessionId: string): void {
  ;(projection as any).bellState.handleBell(
    {
      terminalSessionId,
      terminalWorktreeKey: WORKTREE_KEY,
      index: 1,
      workspaceId: REPO_ROOT,
      presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: BRANCH } },
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
    mocks.openRuntimeMock.mockReset()
    mocks.openRuntimeMock.mockImplementation(async (input: { runtimeType: 'terminal'; request: unknown }) => {
      const runtime = await mocks.createMock(input.request)
      return runtime.ok
        ? {
            ok: true as const,
            runtimeType: 'terminal' as const,
            runtime,
            paneTabsSnapshot: { revision: 7, entries: [] },
          }
        : { ok: false as const, runtimeType: 'terminal' as const, message: runtime.message }
    })
    mocks.closeMock.mockReset()
    mocks.closeMock.mockResolvedValue(true)
    mocks.closeRuntimeMock.mockReset()
    mocks.closeRuntimeMock.mockResolvedValue({
      ok: true,
      runtimeType: 'terminal',
      runtime: { sessions: [] },
    })
    mocks.writeWorkspaceTabsSnapshotMock.mockReset()
    mocks.writeWorkspaceTabsSnapshotMock.mockResolvedValue(true)
    mocks.listWorkspaceTabsMock.mockReset()
    mocks.listWorkspaceTabsMock.mockResolvedValue([])
    mocks.setBadgeMock.mockReset()
    mocks.estimateTerminalGeometryMock.mockClear()
    mocks.estimateManagedTerminalGeometryMock.mockClear()
    mocks.clientIdMock.mockClear()
    projection = new TerminalSessionProjection()
    projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
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

    await projection.createTerminal(terminalBase())

    expect(mocks.estimateManagedTerminalGeometryMock).toHaveBeenCalledWith(host)
    expect(mocks.createMock).toHaveBeenCalledWith({
      target: terminalBase().target,
      kind: 'primary',
      cols: 101,
      rows: 31,
      clientId: 'client_local',
    })
  })

  test('advances catalog coverage with a continuous create delta', async () => {
    projection.reconcileServerSessionsSnapshot(
      { repoRoot: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      { revision: 10, sessions: [] },
      'client_local',
    )

    await projection.createTerminal(terminalBase())
    expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).count).toBe(1)

    expect(
      projection.reconcileServerSessionsSnapshot(
        { repoRoot: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
        { revision: 10, sessions: [] },
        'client_local',
      ),
    ).toBe(false)
    expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).count).toBe(1)
  })

  test('materializes an unseen unchanged reuse without advancing catalog coverage', async () => {
    const scope = { repoRoot: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID }
    projection.reconcileServerSessionsSnapshot(scope, { revision: 2, sessions: [] }, 'client_local')
    mocks.createMock.mockResolvedValueOnce(
      makeCreateResult({
        action: 'reused',
        terminalProjectionEffect: { kind: 'none' },
      }),
    )

    await projection.createTerminal(terminalBase())

    expect(projection.terminalSessionsCatalogCoverageRevision(scope)).toBe(2)
    expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).count).toBe(1)
    expect((projection as any).sessions.get('term-111111111111111111111').currentRuntimeBinding()).toEqual({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
    })
  })

  test('opens terminal and workspace tab through the application operation', async () => {
    await projection.createTerminalWithAdmission(
      terminalBase(),
      {},
      {
        insertAfterIdentity: 'workspace-pane:status',
      },
    )

    expect(mocks.openRuntimeMock).toHaveBeenCalledWith({
      runtimeType: 'terminal',
      request: {
        target: terminalBase().target,
        kind: 'primary',
        cols: 80,
        rows: 24,
        clientId: 'client_local',
      },
      insertAfterIdentity: 'workspace-pane:status',
    })
    expect(mocks.openRuntimeMock).toHaveBeenCalledOnce()
    expect(mocks.writeWorkspaceTabsSnapshotMock).toHaveBeenCalledOnce()
    expect(mocks.listWorkspaceTabsMock).not.toHaveBeenCalled()
  })

  test('passes a startup shell command through terminal create', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    projection.registerHost(WORKTREE_KEY, host)

    await projection.createTerminal(terminalBase(), { startupShellCommand: "bat '/repo/README.md'\r" })

    expect(mocks.createMock).toHaveBeenCalledWith({
      target: terminalBase().target,
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

    await expect(create).resolves.toBe('term-111111111111111111111')
    expect(mocks.createMock).toHaveBeenCalledWith({
      target: terminalBase().target,
      kind: 'additional',
      startupShellCommand: "bat '/repo/README.md'\r",
      cols: 80,
      rows: 24,
      clientId: 'client_local',
    })
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
    await expect(firstCreate).resolves.toBe('term-111111111111111111111')
    await expect(secondCreate).resolves.toBe('term-111111111111111111111')
    expect(mocks.createMock).toHaveBeenCalledTimes(1)
  })

  test('reports ownership for identical in-flight creates', async () => {
    const first = Promise.withResolvers<ReturnType<typeof makeCreateResult>>()
    mocks.createMock.mockReset()
    mocks.createMock.mockReturnValueOnce(first.promise)

    const base = terminalBase()
    const options = { startupShellCommand: "bat '/repo/a.ts'\r" }

    const firstCreate = projection.createTerminalWithAdmission(base, options)
    await vi.waitFor(() => expect(mocks.createMock).toHaveBeenCalledTimes(1))
    const secondCreate = projection.createTerminalWithAdmission(base, { ...options })

    first.resolve(makeCreateResult())
    const firstResult = await firstCreate
    expect(mocks.writeWorkspaceTabsSnapshotMock).toHaveBeenCalledWith(REPO_ROOT, WORKSPACE_RUNTIME_ID, {
      revision: 7,
      entries: [],
    })
    expect(firstResult).toEqual({
      terminalSessionId: 'term-111111111111111111111',
      presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: BRANCH } },
      requestRole: 'leader',
      resourceDisposition: 'created',
      runtimeProjectionApplied: true,
    })
    await expect(secondCreate).resolves.toEqual({
      terminalSessionId: 'term-111111111111111111111',
      presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: BRANCH } },
      requestRole: 'observer',
      resourceDisposition: 'created',
      runtimeProjectionApplied: true,
    })
    expect(mocks.createMock).toHaveBeenCalledTimes(1)
  })

  test.each(['created', 'reused', 'restored'] as const)(
    'preserves the server resource disposition for a %s terminal admission',
    async (resourceDisposition) => {
      mocks.createMock.mockResolvedValueOnce(makeCreateResult({ action: resourceDisposition }))
      const admission = await projection.createTerminalWithAdmission(terminalBase())

      expect(admission).toEqual({
        terminalSessionId: 'term-111111111111111111111',
        presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: BRANCH } },
        requestRole: 'leader',
        resourceDisposition,
        runtimeProjectionApplied: true,
      })
      expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).count).toBe(1)
    },
  )

  test('keeps admission-time geometry for a different command queued behind an in-flight create', async () => {
    const first = Promise.withResolvers<ReturnType<typeof makeCreateResult>>()
    const secondResult = makeCreateResult({
      terminalSessionId: 'term-222222222222222222222',
      terminalRuntimeSessionId: 'pty_session_2_aaaaaaaaa',
    })
    mocks.createMock.mockReset()
    mocks.createMock.mockReturnValueOnce(first.promise).mockResolvedValueOnce(secondResult)

    const firstCreate = projection.createTerminal(terminalBase(), { startupShellCommand: "bat '/repo/a.ts'\r" })
    await vi.waitFor(() => expect(mocks.createMock).toHaveBeenCalledTimes(1))

    const secondCreate = projection.createTerminal(terminalBase(), { startupShellCommand: "bat '/repo/b.ts'\r" })
    // The second queue entry captures default geometry now. The first result
    // later materializes a 101x31 attachment, but must not rewrite this fact.
    await Promise.resolve()
    expect(mocks.createMock).toHaveBeenCalledTimes(1)

    first.resolve(makeCreateResult())
    await expect(firstCreate).resolves.toBe('term-111111111111111111111')
    await vi.waitFor(() => expect(mocks.createMock).toHaveBeenCalledTimes(2))
    await expect(secondCreate).resolves.toBe('term-222222222222222222222')
    expect(mocks.createMock).toHaveBeenLastCalledWith({
      target: terminalBase().target,
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
    await expect(pending).resolves.toBe('term-111111111111111111111')
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

  test.each(['created', 'reused', 'restored'] as const)(
    'keeps a committed %s create result when the current workspace runtime projection has moved on',
    async (resourceDisposition) => {
      const createResponse = Promise.withResolvers<ReturnType<typeof makeCreateResult>>()
      mocks.createMock.mockReturnValueOnce(createResponse.promise)

      const pending = projection.createTerminalWithAdmission(terminalBase())
      await vi.waitFor(() => expect(mocks.createMock).toHaveBeenCalledTimes(1))

      projection.setRuntimeMembershipIndex({
        [REPO_ROOT]: {
          workspaceRuntimeId: 'repo-runtime-new',
        },
      })
      createResponse.resolve(makeCreateResult({ action: resourceDisposition }))

      await expect(pending).resolves.toMatchObject({
        terminalSessionId: 'term-111111111111111111111',
        resourceDisposition,
        runtimeProjectionApplied: false,
      })
      expect(mocks.closeMock).not.toHaveBeenCalled()
      expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).count).toBe(0)
    },
  )

  test('creates with default startup geometry when no host geometry is available yet', async () => {
    const pending = projection.createTerminal(terminalBase())

    expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).createPending).toBe(true)

    await expect(pending).resolves.toBe('term-111111111111111111111')
    expect(mocks.createMock).toHaveBeenCalledTimes(1)
    expect(mocks.createMock).toHaveBeenCalledWith({
      target: terminalBase().target,
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

  test('destroy does not close a server create result that resolves after the queue entry is gone', async () => {
    const { promise, resolve } = Promise.withResolvers<ReturnType<typeof makeCreateResult>>()
    mocks.createMock.mockReturnValueOnce(promise)
    const pending = projection.createTerminal(terminalBase())

    await vi.waitFor(() => expect(mocks.createMock).toHaveBeenCalledTimes(1))
    const expectation = expect(pending).rejects.toThrow('terminal session projection destroyed')
    projection.destroy()
    await expectation

    resolve(makeCreateResult())
    await Promise.resolve()
    await Promise.resolve()
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
      target: terminalBase().target,
      kind: 'primary',
      cols: 80,
      rows: 24,
      clientId: 'client_local',
    })
    expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).createPending).toBe(false)
    await expect(pending).resolves.toBe('term-111111111111111111111')
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

    await expect(pending).resolves.toBe('term-111111111111111111111')
    expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).createPending).toBe(false)
    expect(mocks.createMock).toHaveBeenCalledWith({
      target: terminalBase().target,
      kind: 'primary',
      cols: 80,
      rows: 24,
      clientId: 'client_local',
    })
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
      terminalRuntimeGeneration: 1,
      terminalSessionId: 'term-111111111111111111111',
    })

    // The local session is gone; the worktree snapshot is empty.
    expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).sessions.length).toBe(0)
  })

  test('durable close: exact runtime matching does not require the pty reverse index', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    projection.registerHost(WORKTREE_KEY, host)
    await projection.createTerminal(terminalBase())

    expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).sessions.length).toBe(1)
    ;(projection as any).terminalSessionIdByTerminalRuntimeSessionId.clear()

    projection.handleSessionClosed({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      terminalSessionId: 'term-111111111111111111111',
    })

    expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).sessions.length).toBe(0)
  })

  test('durable close: runtime mismatch does not delete the durable candidate', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    projection.registerHost(WORKTREE_KEY, host)
    await projection.createTerminal(terminalBase())
    ;(projection as any).terminalSessionIdByTerminalRuntimeSessionId.clear()

    projection.handleSessionClosed({
      terminalRuntimeSessionId: 'pty_session_missing_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      terminalSessionId: 'term-111111111111111111111',
    })

    expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).sessions.length).toBe(1)
  })

  test('caps pending server bells for unknown sessions', () => {
    for (let index = 0; index < 100; index += 1) {
      projection.handleServerBell({
        terminalRuntimeSessionId: `pty_session_${index}_aaaaaaaaa`,
        terminalRuntimeGeneration: 1,
        terminalSessionId: `term-${String(index).padStart(21, '0')}`,
        repoRoot: REPO_ROOT,
        processName: 'zsh',
        canonicalTitle: null,
      })
    }

    const pendingBells = (projection as any).pendingServerBellByRuntimeBindingKey as Map<
      string,
      { terminalSessionId: string; terminalRuntimeSessionId: string }
    >
    expect(pendingBells.size).toBe(99)
    expect(
      Array.from(pendingBells.values()).some((event) => event.terminalSessionId === 'term-000000000000000000000'),
    ).toBe(false)
    expect(
      Array.from(pendingBells.values()).some((event) => event.terminalSessionId === 'term-000000000000000000099'),
    ).toBe(true)
  })

  test('clears pending server bell when an unknown session is closed', () => {
    projection.handleServerBell({
      terminalRuntimeSessionId: 'pty_session_unknown_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      terminalSessionId: 'term-unknownunknownunknown',
      repoRoot: REPO_ROOT,
      processName: 'zsh',
      canonicalTitle: null,
    })

    const pendingBells = (projection as any).pendingServerBellByRuntimeBindingKey as Map<
      string,
      { terminalSessionId: string; terminalRuntimeSessionId: string }
    >
    expect(Array.from(pendingBells.values())).toContainEqual(
      expect.objectContaining({
        terminalSessionId: 'term-unknownunknownunknown',
        terminalRuntimeSessionId: 'pty_session_unknown_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
      }),
    )

    projection.handleSessionClosed({
      terminalRuntimeSessionId: 'pty_session_unknown_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      terminalSessionId: 'term-unknownunknownunknown',
    })

    expect(Array.from(pendingBells.values())).not.toContainEqual(
      expect.objectContaining({
        terminalSessionId: 'term-unknownunknownunknown',
        terminalRuntimeSessionId: 'pty_session_unknown_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
      }),
    )
  })

  test('keeps a pending server bell when a stale runtime close arrives', () => {
    projection.handleServerBell({
      terminalRuntimeSessionId: 'pty_session_current_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      terminalSessionId: 'term-unknownunknownunknown',
      repoRoot: REPO_ROOT,
      processName: 'zsh',
      canonicalTitle: null,
    })

    projection.handleSessionClosed({
      terminalRuntimeSessionId: 'pty_session_stale_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      terminalSessionId: 'term-unknownunknownunknown',
    })

    const pendingBells = (projection as any).pendingServerBellByRuntimeBindingKey as Map<
      string,
      { terminalSessionId: string; terminalRuntimeSessionId: string }
    >
    expect(Array.from(pendingBells.values())).toContainEqual(
      expect.objectContaining({
        terminalSessionId: 'term-unknownunknownunknown',
        terminalRuntimeSessionId: 'pty_session_current_aaaaaaaaa',
      }),
    )
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
        workspaceId: REPO_ROOT,
        branch: BRANCH,
        worktreePath: WORKTREE_PATH,
      },
      { processName: 'zsh', visible: false },
    )
    expect(mocks.setBadgeMock).toHaveBeenLastCalledWith(1)

    projection.setRuntimeMembershipIndex({})

    expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).sessions.length).toBe(0)
    expect(mocks.setBadgeMock).toHaveBeenLastCalledWith(0)
  })

  test('publishes repo bell counts through repo listeners', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    projection.registerHost(WORKTREE_KEY, host)
    const listener = vi.fn()
    const unsubscribe = projection.subscribeWorkspaceBellCount(REPO_ROOT, listener)

    try {
      const terminalSessionId = await projection.createTerminal(terminalBase())
      expect(projection.workspaceBellCount(REPO_ROOT)).toBe(0)
      expect(listener).not.toHaveBeenCalled()

      emitBellForKey(projection, terminalSessionId)

      expect(projection.workspaceBellCount(REPO_ROOT)).toBe(1)
      expect(listener).toHaveBeenCalledTimes(1)

      listener.mockClear()
      projection.scrollToBottom(terminalSessionId)

      expect(projection.workspaceBellCount(REPO_ROOT)).toBe(1)
      expect(listener).not.toHaveBeenCalled()

      listener.mockClear()
      projection.clearBell(terminalSessionId)

      expect(projection.workspaceBellCount(REPO_ROOT)).toBe(0)
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
    const unsubscribe = projection.subscribeWorkspaceBellCount(REPO_ROOT, listener)

    try {
      expect(projection.workspaceBellCount(REPO_ROOT)).toBe(1)

      projection.handleSessionClosed({
        terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId,
      })

      expect(projection.workspaceBellCount(REPO_ROOT)).toBe(0)
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

    projection.setRuntimeMembershipIndex({
      [REPO_ROOT]: {
        workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      },
    })

    expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).sessions.length).toBe(1)
  })
})
