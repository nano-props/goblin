// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { TerminalCreateResult } from '#/shared/terminal-types.ts'
import { canonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'
import { runtimeWorkspacePaneTargetForTest } from '#/web/test-utils/workspace-pane-tabs.ts'
import {
  requiredTerminalSession,
  terminalSessionProjectionAccess,
} from '#/web/test-utils/terminal-session-projection-access.ts'

const mocks = vi.hoisted(() => ({
  createMock: vi.fn(),
  openRuntimeMock: vi.fn(),
  closeRuntimeMock: vi.fn(),
  writeWorkspaceTabsSnapshotMock: vi.fn(),
  closeMock: vi.fn(),
  listWorkspaceTabsMock: vi.fn(),
  setBadgeMock: vi.fn(),
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

vi.mock('#/web/client-page-id.ts', () => ({
  readClientPageId: mocks.clientIdMock,
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
    findNext() {
      return { resultIndex: -1, resultCount: 0, found: false }
    }
    findPrevious() {
      return { resultIndex: -1, resultCount: 0, found: false }
    }
    clearSearch(): void {}
    scrollToBottom(): void {}
    scrollLines(): void {}
    captureInputWriter(): null {
      return null
    }
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
    controlsTerminal(): boolean {
      return this.snapshotState.attachment?.role === 'controller'
    }
    snapshot() {
      return this.snapshotState
    }
    hydrate(input: any): void {
      this.terminalRuntimeSessionId = input.terminalRuntimeSessionId
      this.terminalRuntimeGeneration = input.terminalRuntimeGeneration
      this.snapshotState = {
        phase: input.phase,
        message: input.message,
        processName: input.processName,
        canonicalTitle: input.canonicalTitle,
        attachment: {
          role: input.role,
          controllerStatus: input.controllerStatus,
          active: input.role === 'controller',
          canTakeover: input.role !== 'controller',
          canonicalSize: input.canonicalSize,
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
import { runtimeMembershipIndexFromEntries } from '#/web/components/terminal/terminal-runtime-membership-index.ts'

function workspaceIdFixture(input: string) {
  const workspaceId = canonicalWorkspaceLocator(input)
  if (!workspaceId) throw new Error('invalid workspace locator fixture')
  return workspaceId
}

const REPO_ROOT = workspaceIdFixture('goblin+file:///repo')
const WORKTREE_PATH = '/repo'
const BRANCH = 'main'
const WORKTREE_KEY = `${REPO_ROOT}\0${REPO_ROOT}`

function makeRuntimeMembershipIndex() {
  return runtimeMembershipIndexFromEntries([{ id: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID }])
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
    terminalRuntimeGeneration: 0,
    identityRevision: 0,
    processName: '',
    canonicalTitle: null,
    phase: 'opening' as const,
    message: null,
    controller: null,
    canonicalSize: null,
    ...overrides,
  }
}

function emitBellForKey(projection: TerminalSessionProjection, terminalSessionId: string): void {
  terminalSessionProjectionAccess(projection).bellState.handleBell(
    {
      terminalSessionId,
      index: 1,
      ...terminalBase(),
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
    mocks.clientIdMock.mockClear()
    projection = new TerminalSessionProjection()
    projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
    setTerminalSessionProjectionForTests(projection)
  })

  afterEach(() => {
    projection.destroy()
    setTerminalSessionProjectionForTests(null)
    document.body.innerHTML = ''
  })

  test('creates a prepared terminal without application geometry', async () => {
    await projection.createTerminal(terminalBase())

    expect(mocks.createMock).toHaveBeenCalledWith({
      target: terminalBase().target,
      kind: 'primary',
    })
  })

  test('advances catalog coverage with a continuous create delta', async () => {
    projection.reconcileServerSessionsSnapshot(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      { revision: 10, sessions: [] },
      'client_local',
    )

    await projection.createTerminal(terminalBase())
    expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(1)

    expect(
      projection.reconcileServerSessionsSnapshot(
        { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
        { revision: 10, sessions: [] },
        'client_local',
      ),
    ).toBe(false)
    expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(1)
  })

  test('materializes an unseen unchanged reuse without advancing catalog coverage', async () => {
    const scope = { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID }
    projection.reconcileServerSessionsSnapshot(scope, { revision: 2, sessions: [] }, 'client_local')
    mocks.createMock.mockResolvedValueOnce(
      makeCreateResult({
        action: 'reused',
        terminalProjectionEffect: { kind: 'none' },
      }),
    )

    await projection.createTerminal(terminalBase())

    expect(projection.terminalSessionsCatalogCoverageRevision(scope)).toBe(2)
    expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(1)
    expect(requiredTerminalSession(projection, 'term-111111111111111111111').currentRuntimeBinding()).toEqual({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 0,
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
      },
      insertAfterIdentity: 'workspace-pane:status',
    })
    expect(mocks.openRuntimeMock).toHaveBeenCalledOnce()
    expect(mocks.writeWorkspaceTabsSnapshotMock).toHaveBeenCalledOnce()
    expect(mocks.listWorkspaceTabsMock).not.toHaveBeenCalled()
  })

  test('passes a startup shell command through terminal create', async () => {
    await projection.createTerminal(terminalBase(), { startupShellCommand: "bat '/repo/README.md'\r" })

    expect(mocks.createMock).toHaveBeenCalledWith({
      target: terminalBase().target,
      kind: 'additional',
      startupShellCommand: "bat '/repo/README.md'\r",
    })
  })

  test('marks create pending before resolving an async startup shell command', async () => {
    const startupCommand = Promise.withResolvers<string>()
    const create = projection.createTerminal(terminalBase(), {
      resolveStartupShellCommand: async () => await startupCommand.promise,
    })

    await vi.waitFor(() => {
      expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).createPending).toBe(true)
    })
    expect(mocks.createMock).not.toHaveBeenCalled()

    startupCommand.resolve("bat '/repo/README.md'\r")
    await vi.waitFor(() => expect(mocks.createMock).toHaveBeenCalledTimes(1))

    await expect(create).resolves.toBe('term-111111111111111111111')
    expect(mocks.createMock).toHaveBeenCalledWith({
      target: terminalBase().target,
      kind: 'additional',
      startupShellCommand: "bat '/repo/README.md'\r",
    })
  })

  test('destroy cancels create while async startup shell command is resolving', async () => {
    const startupCommand = Promise.withResolvers<string>()
    const create = projection.createTerminal(terminalBase(), {
      resolveStartupShellCommand: async () => await startupCommand.promise,
    })

    await vi.waitFor(() => {
      expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).createPending).toBe(true)
    })
    const createExpectation = expect(create).rejects.toThrow('terminal session projection destroyed')
    projection.destroy()
    await createExpectation

    startupCommand.resolve("bat '/repo/README.md'\r")
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(mocks.createMock).not.toHaveBeenCalled()
    expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).createPending).toBe(false)
  })

  test('deduplicates identical in-flight creates for the same filesystem target', async () => {
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
      expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(1)
    },
  )

  test('keeps a different command queued behind an in-flight create', async () => {
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
    })
  })

  test('clears the native badge when the projection starts', () => {
    expect(mocks.setBadgeMock).toHaveBeenCalledWith(0)
  })

  test('keeps the filesystem target pending while create is in flight', async () => {
    const { promise, resolve } = Promise.withResolvers<ReturnType<typeof makeCreateResult>>()
    mocks.createMock.mockReturnValueOnce(promise)
    const pending = projection.createTerminal(terminalBase())

    await vi.waitFor(() => expect(mocks.createMock).toHaveBeenCalledTimes(1))
    expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).createPending).toBe(true)
    expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(0)

    resolve(makeCreateResult())
    await expect(pending).resolves.toBe('term-111111111111111111111')
    expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).createPending).toBe(false)
    expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(1)
  })

  test('clears createPending when create rejects', async () => {
    mocks.createMock.mockRejectedValueOnce(new Error('boom'))
    await expect(projection.createTerminal(terminalBase())).rejects.toThrow('boom')
    expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).createPending).toBe(false)
    expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(0)
  })

  test.each(['created', 'reused', 'restored'] as const)(
    'keeps a committed %s create result when the current workspace runtime projection has moved on',
    async (resourceDisposition) => {
      const createResponse = Promise.withResolvers<ReturnType<typeof makeCreateResult>>()
      mocks.createMock.mockReturnValueOnce(createResponse.promise)

      const pending = projection.createTerminalWithAdmission(terminalBase())
      await vi.waitFor(() => expect(mocks.createMock).toHaveBeenCalledTimes(1))

      projection.setRuntimeMembershipIndex(
        runtimeMembershipIndexFromEntries([{ id: REPO_ROOT, workspaceRuntimeId: 'repo-runtime-new' }]),
      )
      createResponse.resolve(makeCreateResult({ action: resourceDisposition }))

      await expect(pending).resolves.toMatchObject({
        terminalSessionId: 'term-111111111111111111111',
        resourceDisposition,
        runtimeProjectionApplied: false,
      })
      expect(mocks.closeMock).not.toHaveBeenCalled()
      expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(0)
    },
  )

  test('does not send application geometry when creating without a mounted host', async () => {
    const pending = projection.createTerminal(terminalBase())

    expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).createPending).toBe(true)

    await expect(pending).resolves.toBe('term-111111111111111111111')
    expect(mocks.createMock).toHaveBeenCalledTimes(1)
    expect(mocks.createMock).toHaveBeenCalledWith({
      target: terminalBase().target,
      kind: 'primary',
    })
  })

  test('pending create rejected on destroy while server create is in flight', async () => {
    const { promise } = Promise.withResolvers<ReturnType<typeof makeCreateResult>>()
    mocks.createMock.mockReturnValueOnce(promise)
    const pending = projection.createTerminal(terminalBase())

    expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).createPending).toBe(true)
    expect(terminalSessionProjectionAccess(projection).lifecycleQueues.hasCreate(WORKTREE_KEY)).toBe(true)
    await vi.waitFor(() => expect(mocks.createMock).toHaveBeenCalledTimes(1))

    // Attach the rejection handler before destroy() so the rejected
    // promise is not flagged as unhandled between the synchronous
    // `destroy()` call and the later `expect(...).rejects` chain.
    const expectation = expect(pending).rejects.toThrow('terminal session projection destroyed')
    projection.destroy()
    await expectation
    expect(terminalSessionProjectionAccess(projection).lifecycleQueues.hasCreate(WORKTREE_KEY)).toBe(false)
    expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).createPending).toBe(false)
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

  test('durable close: handleSessionClosed drops the matching local session', async () => {
    // The server emits a session-closed broadcast when window A
    // closes a session. Sibling windows route the event into
    // handleSessionClosed to drop the local entry without a
    // full reconcile.
    await projection.createTerminal(terminalBase())

    expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).sessions.length).toBe(1)

    projection.handleSessionClosed({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 0,
      terminalSessionId: 'term-111111111111111111111',
    })

    // The local session is gone; the filesystem target snapshot is empty.
    expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).sessions.length).toBe(0)
  })

  test('durable close: exact canonical and runtime identity removes the session', async () => {
    await projection.createTerminal(terminalBase())

    expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).sessions.length).toBe(1)
    projection.handleSessionClosed({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 0,
      terminalSessionId: 'term-111111111111111111111',
    })

    expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).sessions.length).toBe(0)
  })

  test('durable close: runtime mismatch does not delete the durable candidate', async () => {
    await projection.createTerminal(terminalBase())
    projection.handleSessionClosed({
      terminalRuntimeSessionId: 'pty_session_missing_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      terminalSessionId: 'term-111111111111111111111',
    })

    expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).sessions.length).toBe(1)
  })

  test('caps pending server bells for unknown sessions', () => {
    for (let index = 0; index < 100; index += 1) {
      projection.handleServerBell({
        terminalRuntimeSessionId: `pty_session_${index}_aaaaaaaaa`,
        terminalRuntimeGeneration: 1,
        terminalSessionId: `term-${String(index).padStart(21, '0')}`,
        workspaceId: REPO_ROOT,
        processName: 'zsh',
        canonicalTitle: null,
      })
    }

    const pendingBells = terminalSessionProjectionAccess(projection).pendingServerBellByRuntimeBindingKey as Map<
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
      workspaceId: REPO_ROOT,
      processName: 'zsh',
      canonicalTitle: null,
    })

    const pendingBells = terminalSessionProjectionAccess(projection).pendingServerBellByRuntimeBindingKey as Map<
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
      workspaceId: REPO_ROOT,
      processName: 'zsh',
      canonicalTitle: null,
    })

    projection.handleSessionClosed({
      terminalRuntimeSessionId: 'pty_session_stale_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      terminalSessionId: 'term-unknownunknownunknown',
    })

    const pendingBells = terminalSessionProjectionAccess(projection).pendingServerBellByRuntimeBindingKey as Map<
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
    const terminalSessionId = await projection.createTerminal(terminalBase())
    mocks.setBadgeMock.mockClear()
    terminalSessionProjectionAccess(projection).bellState.handleBell(
      {
        terminalSessionId,
        index: 1,
        ...terminalBase(),
      },
      { processName: 'zsh', visible: false },
    )
    expect(mocks.setBadgeMock).toHaveBeenLastCalledWith(1)

    projection.setRuntimeMembershipIndex(runtimeMembershipIndexFromEntries([]))

    expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).sessions.length).toBe(0)
    expect(mocks.setBadgeMock).toHaveBeenLastCalledWith(0)
  })

  test('publishes repo bell counts through repo listeners', async () => {
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
    const terminalSessionId = await projection.createTerminal(terminalBase())
    emitBellForKey(projection, terminalSessionId)

    const listener = vi.fn()
    const unsubscribe = projection.subscribeWorkspaceBellCount(REPO_ROOT, listener)

    try {
      expect(projection.workspaceBellCount(REPO_ROOT)).toBe(1)

      projection.handleSessionClosed({
        terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
        terminalRuntimeGeneration: 0,
        terminalSessionId,
      })

      expect(projection.workspaceBellCount(REPO_ROOT)).toBe(0)
      expect(listener).toHaveBeenCalledTimes(1)
    } finally {
      unsubscribe()
    }
  })

  test('does not prune sessions when the repo still exists but branch metadata is temporarily missing', async () => {
    await projection.createTerminal(terminalBase())

    projection.setRuntimeMembershipIndex(
      runtimeMembershipIndexFromEntries([{ id: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID }]),
    )

    expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).sessions.length).toBe(1)
  })
})
