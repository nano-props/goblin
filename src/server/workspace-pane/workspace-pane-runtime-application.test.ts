import { describe, expect, test, vi } from 'vitest'
import { createWorkspacePaneRuntimeApplication } from '#/server/workspace-pane/workspace-pane-runtime-application.ts'
import type { ServerTerminalCreateResult } from '#/server/terminal/terminal-session-creator.ts'
import type { TerminalCreateResult } from '#/shared/terminal-types.ts'
import {
  createPhysicalWorktreeOperationCoordinator,
  type PhysicalWorktreeOperationPermit,
} from '#/server/worktree-removal/physical-worktree-operation-coordinator.ts'
import {
  issueTestPhysicalWorktreeExecutionCapability,
  testPhysicalWorktreeExecutionCapability,
  testPhysicalWorktreeIdentity,
  testPhysicalWorktrees,
} from '#/server/test-utils/physical-worktree-identity.ts'
import { RemoteWorkspaceRuntimeFailureError } from '#/server/modules/remote-workspace-runtime-failure.ts'
import { canonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'
import { terminalSessionRuntimeScope } from '#/server/terminal/terminal-session-scope.ts'
import { WorkspacePaneRuntimeStaleError } from '#/server/workspace-pane/workspace-pane-tabs-coordinator.ts'
import type { WorkspaceProbeState } from '#/shared/workspace-runtime.ts'
import type * as WorkspaceRuntimesModule from '#/server/modules/workspace-runtimes.ts'
import type * as RemoteWorkspaceFailureSettlement from '#/server/modules/remote-workspace-runtime-failure-settlement.ts'

const failRemoteWorkspaceRuntimeIfNeededMock = vi.hoisted(() => vi.fn())
const workspaceProbeStateForRuntimeMock = vi.hoisted(() =>
  vi.fn<() => WorkspaceProbeState>(() => ({
    status: 'ready' as const,
    name: 'Mock workspace',
    capabilities: {
      files: { read: true as const, write: true },
      terminal: { available: true },
      git: { status: 'available' as const, worktrees: true, pullRequests: { provider: 'none' as const } },
    },
    diagnostics: [],
  })),
)
vi.mock('#/server/modules/remote-workspace-runtime-failure-settlement.ts', async (importActual) => {
  const actual = await importActual<typeof RemoteWorkspaceFailureSettlement>()
  return { ...actual, failRemoteWorkspaceRuntimeIfNeeded: failRemoteWorkspaceRuntimeIfNeededMock }
})
vi.mock('#/server/modules/workspace-runtimes.ts', async (importActual) => {
  const actual = await importActual<typeof WorkspaceRuntimesModule>()
  return { ...actual, workspaceProbeStateForRuntime: workspaceProbeStateForRuntimeMock }
})

const workspaceId = canonicalWorkspaceLocator('goblin+file:///repo')
const worktreeRoot = canonicalWorkspaceLocator('goblin+file:///repo/worktree')
const otherWorktreeRoot = canonicalWorkspaceLocator('goblin+file:///repo/other-worktree')
if (!workspaceId || !worktreeRoot || !otherWorktreeRoot) throw new Error('invalid workspace locator fixture')

const request = {
  workspaceId: workspaceId,
  workspaceRuntimeId: 'repo-runtime-test',
  branch: 'main',
  worktreePath: '/repo/worktree',
  target: { kind: 'git-worktree' as const, workspaceId, workspaceRuntimeId: 'repo-runtime-test', root: worktreeRoot },
  kind: 'primary' as const,
  cols: 100,
  rows: 30,
  clientId: 'client-test',
}
const paneTabsSnapshot = { revision: 1, entries: [] }

describe('WorkspacePaneRuntimeApplication', () => {
  test('rejects terminal creation from an unavailable authoritative capability', async () => {
    workspaceProbeStateForRuntimeMock.mockReturnValueOnce({
      status: 'ready',
      name: 'Mock workspace',
      capabilities: {
        files: { read: true, write: true },
        terminal: { available: false },
        git: { status: 'unavailable' },
      },
      diagnostics: [],
    })
    const capture = vi.fn()
    const createAdmitted = vi.fn()
    const application = createWorkspacePaneRuntimeApplication({
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      physicalWorktrees: { capture },
      terminalWorktree: { listSessionsForUser: async () => [] },
      terminal: { createAdmitted, close: () => false },
      workspaceTabsCoordinator: { ensureRuntimeTabForSession: vi.fn() },
      isCurrentWorkspaceRuntime: () => true,
      broadcastWorkspaceTabsChanged: vi.fn(),
    })

    await expect(application.open('client-test', 'user-test', { runtimeType: 'terminal', request })).resolves.toEqual({
      ok: false,
      runtimeType: 'terminal',
      message: 'error.unavailable',
    })
    expect(capture).not.toHaveBeenCalled()
    expect(createAdmitted).not.toHaveBeenCalled()
  })

  test('rejects terminal creation while the authoritative capability is transitioning', async () => {
    workspaceProbeStateForRuntimeMock.mockReturnValueOnce({ status: 'probing' })
    const capture = vi.fn()
    const application = createWorkspacePaneRuntimeApplication({
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      physicalWorktrees: { capture },
      terminalWorktree: { listSessionsForUser: async () => [] },
      terminal: { createAdmitted: vi.fn(), close: () => false },
      workspaceTabsCoordinator: { ensureRuntimeTabForSession: vi.fn() },
      isCurrentWorkspaceRuntime: () => true,
      broadcastWorkspaceTabsChanged: vi.fn(),
    })

    await expect(
      application.open('client-test', 'user-test', { runtimeType: 'terminal', request }),
    ).resolves.toMatchObject({
      ok: false,
      message: 'error.unavailable',
    })
    expect(capture).not.toHaveBeenCalled()
  })

  test('rejects when terminal capability becomes unavailable during physical target capture', async () => {
    workspaceProbeStateForRuntimeMock
      .mockReturnValueOnce({
        status: 'ready',
        name: 'Mock workspace',
        capabilities: {
          files: { read: true, write: true },
          terminal: { available: true },
          git: { status: 'unavailable' },
        },
        diagnostics: [],
      })
      .mockReturnValueOnce({
        status: 'ready',
        name: 'Mock workspace',
        capabilities: {
          files: { read: true, write: true },
          terminal: { available: false },
          git: { status: 'unavailable' },
        },
        diagnostics: [],
      })
    const createAdmitted = vi.fn()
    const application = createWorkspacePaneRuntimeApplication({
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      physicalWorktrees: { capture: async () => testPhysicalWorktreeExecutionCapability(request.worktreePath) },
      terminalWorktree: { listSessionsForUser: async () => [] },
      terminal: { createAdmitted, close: () => false },
      workspaceTabsCoordinator: { ensureRuntimeTabForSession: vi.fn() },
      isCurrentWorkspaceRuntime: () => true,
      broadcastWorkspaceTabsChanged: vi.fn(),
    })

    await expect(
      application.open('client-test', 'user-test', { runtimeType: 'terminal', request }),
    ).resolves.toMatchObject({
      ok: false,
      message: 'error.unavailable',
    })
    expect(createAdmitted).not.toHaveBeenCalled()
  })

  test('returns the provider result and broadcasts the committed workspace revision', async () => {
    const runtime = terminalCreateSuccess()
    const create = vi.fn(async () => runtime)
    const physicalWorktreeCapability = testPhysicalWorktreeExecutionCapability(request.worktreePath)
    const capture = vi.fn(async () => physicalWorktreeCapability)
    const ensureRuntimeTabForSession = vi.fn(async (input: { commitAdmission: (canonicalBranch: string) => void }) => {
      input.commitAdmission(request.branch)
      return { kind: 'committed' as const, snapshot: paneTabsSnapshot }
    })
    const broadcastWorkspaceTabsChanged = vi.fn()
    const application = createWorkspacePaneRuntimeApplication({
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      physicalWorktrees: { capture },
      terminalWorktree: { listSessionsForUser: async () => [] },
      terminal: { createAdmitted: create, close: () => false },
      workspaceTabsCoordinator: { ensureRuntimeTabForSession },
      isCurrentWorkspaceRuntime: () => true,
      broadcastWorkspaceTabsChanged,
    })

    const result = await application.open('client-test', 'user-test', {
      runtimeType: 'terminal',
      request,
      insertAfterIdentity: 'workspace-pane:status',
    })

    expect(capture).toHaveBeenCalledOnce()
    expect(create).toHaveBeenCalledWith(
      'client-test',
      'user-test',
      {
        kind: request.kind,
        startupShellCommand: undefined,
        cols: request.cols,
        rows: request.rows,
        clientId: request.clientId,
        target: request.target,
      },
      { physicalWorktreeCapability, permit: expect.any(Object) },
    )
    expect(ensureRuntimeTabForSession).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-test',
        target: request.target,
        worktreePath: '/repo/worktree',
        runtimeType: 'terminal',
        sessionId: runtime.terminalSessionId,
        insertAfterIdentity: 'workspace-pane:status',
      }),
    )
    expect(result).toEqual({
      ok: true,
      runtimeType: 'terminal',
      runtime: publishedTerminalResult(runtime),
      paneTabsSnapshot,
    })
    expect(broadcastWorkspaceTabsChanged).toHaveBeenCalledWith(
      'user-test',
      request.workspaceId,
      request.workspaceRuntimeId,
      paneTabsSnapshot.revision,
    )
  })

  test('does not touch tabs when the provider create fails', async () => {
    const ensureRuntimeTabForSession = vi.fn()
    const broadcastWorkspaceTabsChanged = vi.fn()
    const application = createWorkspacePaneRuntimeApplication({
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      physicalWorktrees: testPhysicalWorktrees,
      terminalWorktree: { listSessionsForUser: async () => [] },
      terminal: {
        createAdmitted: async () => ({ ok: false, message: 'error.terminal-create-failed' }),
        close: () => false,
      },
      workspaceTabsCoordinator: { ensureRuntimeTabForSession },
      isCurrentWorkspaceRuntime: () => true,
      broadcastWorkspaceTabsChanged,
    })

    await expect(application.open('client-test', 'user-test', { runtimeType: 'terminal', request })).resolves.toEqual({
      ok: false,
      runtimeType: 'terminal',
      message: 'error.terminal-create-failed',
    })
    expect(ensureRuntimeTabForSession).not.toHaveBeenCalled()
    expect(broadcastWorkspaceTabsChanged).not.toHaveBeenCalled()
  })

  test('passes the native workspace root through terminal admission', async () => {
    const target = {
      kind: 'workspace-root' as const,
      workspaceId,
      workspaceRuntimeId: request.workspaceRuntimeId,
    }
    const workspaceRequest = { ...request, worktreePath: workspaceId, target }
    const createAdmitted = vi.fn(async () => ({ ok: false as const, message: 'expected-stop' }))
    const capture = vi.fn(async () => testPhysicalWorktreeExecutionCapability('/repo'))
    const application = createWorkspacePaneRuntimeApplication({
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      physicalWorktrees: { capture },
      terminalWorktree: { listSessionsForUser: async () => [] },
      terminal: { createAdmitted, close: () => false },
      workspaceTabsCoordinator: { ensureRuntimeTabForSession: vi.fn() },
      isCurrentWorkspaceRuntime: () => true,
      broadcastWorkspaceTabsChanged: vi.fn(),
    })

    await application.open('client-test', 'user-test', { runtimeType: 'terminal', request: workspaceRequest })

    expect(capture).toHaveBeenCalledWith(expect.objectContaining({ repoRoot: workspaceId, worktreePath: '/repo' }))
    expect(createAdmitted).toHaveBeenCalledWith(
      'client-test',
      'user-test',
      expect.objectContaining({ target }),
      expect.any(Object),
    )
  })

  test('normalizes a workspace locator before closing its native terminal session', async () => {
    const target = {
      kind: 'workspace-root' as const,
      workspaceId,
      workspaceRuntimeId: request.workspaceRuntimeId,
    }
    const close = vi.fn(() => true)
    const application = createWorkspacePaneRuntimeApplication({
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      physicalWorktrees: {
        capture: async () => testPhysicalWorktreeExecutionCapability('/repo'),
      },
      terminalWorktree: {
        listSessionsForUser: async () => [
          {
            ...terminalSession('term-workspaceworkspace001', 'pty_workspace_aaaaaaaa'),
            target,
            presentation: { kind: 'workspace-root' },
            nativeWorktreePath: '/repo',
          },
        ],
      },
      terminal: { createAdmitted: async () => ({ ok: false, message: 'unexpected' }), close },
      workspaceTabsCoordinator: { ensureRuntimeTabForSession: vi.fn() },
      isCurrentWorkspaceRuntime: () => true,
      broadcastWorkspaceTabsChanged: vi.fn(),
    })

    await expect(
      application.close('client-test', 'user-test', {
        runtimeType: 'terminal',
        sessionId: 'term-workspaceworkspace001',
        target: { target },
      }),
    ).resolves.toMatchObject({ ok: true, runtime: { action: 'closed' } })
    expect(close).toHaveBeenCalledOnce()
  })

  test('reports remote runtime failure when physical worktree capture proves transport failure', async () => {
    const failure = new RemoteWorkspaceRuntimeFailureError({
      workspaceId: request.workspaceId,
      workspaceRuntimeId: request.workspaceRuntimeId,
      reason: 'unreachable',
    })
    const create = vi.fn()
    const ensureRuntimeTabForSession = vi.fn()
    failRemoteWorkspaceRuntimeIfNeededMock.mockClear()
    const application = createWorkspacePaneRuntimeApplication({
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      physicalWorktrees: {
        capture: async () => {
          throw failure
        },
      },
      terminalWorktree: { listSessionsForUser: async () => [] },
      terminal: { createAdmitted: create, close: () => false },
      workspaceTabsCoordinator: { ensureRuntimeTabForSession },
      isCurrentWorkspaceRuntime: () => true,
      broadcastWorkspaceTabsChanged: vi.fn(),
    })

    await expect(application.open('client-test', 'user-test', { runtimeType: 'terminal', request })).resolves.toEqual({
      ok: false,
      runtimeType: 'terminal',
      message: 'unreachable',
    })
    expect(failRemoteWorkspaceRuntimeIfNeededMock).toHaveBeenCalledWith('user-test', failure)
    expect(create).not.toHaveBeenCalled()
    expect(ensureRuntimeTabForSession).not.toHaveBeenCalled()
  })

  test('reports remote runtime failure when queued physical validation proves transport failure', async () => {
    const failure = new RemoteWorkspaceRuntimeFailureError({
      workspaceId: request.workspaceId,
      workspaceRuntimeId: request.workspaceRuntimeId,
      reason: 'unreachable',
      message: 'connection refused',
    })
    const capability = issueTestPhysicalWorktreeExecutionCapability({
      identity: testPhysicalWorktreeIdentity(request.worktreePath),
      validateExecution: async () => {
        throw failure
      },
    })
    const create = vi.fn()
    const ensureRuntimeTabForSession = vi.fn()
    failRemoteWorkspaceRuntimeIfNeededMock.mockClear()
    const application = createWorkspacePaneRuntimeApplication({
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      physicalWorktrees: { capture: async () => capability },
      terminalWorktree: { listSessionsForUser: async () => [] },
      terminal: { createAdmitted: create, close: () => false },
      workspaceTabsCoordinator: { ensureRuntimeTabForSession },
      isCurrentWorkspaceRuntime: () => true,
      broadcastWorkspaceTabsChanged: vi.fn(),
    })

    await expect(application.open('client-test', 'user-test', { runtimeType: 'terminal', request })).resolves.toEqual({
      ok: false,
      runtimeType: 'terminal',
      message: 'connection refused',
    })
    expect(failRemoteWorkspaceRuntimeIfNeededMock).toHaveBeenCalledWith('user-test', failure)
    expect(create).not.toHaveBeenCalled()
    expect(ensureRuntimeTabForSession).not.toHaveBeenCalled()
  })

  test.each(['created', 'reused', 'restored'] as const)(
    'rechecks workspace runtime authority at the tab commit boundary for a %s terminal',
    async (action) => {
      const runtime = terminalCreateSuccess(action)
      const retire = vi.fn()
      runtime.admission =
        action === 'created'
          ? { ...runtime.admission, kind: 'prepared', abort: retire }
          : { ...runtime.admission, kind: 'existing', abort: vi.fn() }
      const close = vi.fn(() => true)
      const stale = { ok: false as const, runtimeType: 'terminal' as const, message: 'error.workspace-runtime-stale' }
      const ensureRuntimeTabForSession = vi.fn(async (input: { isRuntimeCurrent: () => boolean }) =>
        input.isRuntimeCurrent()
          ? { kind: 'committed' as const, snapshot: paneTabsSnapshot }
          : { kind: 'runtime-stale' as const },
      )
      const broadcastWorkspaceTabsChanged = vi.fn()
      const providerResult = deferred<Extract<ServerTerminalCreateResult, { ok: true }>>()
      let current = true
      const create = vi.fn(async () => {
        const result = await providerResult.promise
        current = false
        return result
      })
      const isCurrentWorkspaceRuntime = vi.fn(() => current)
      const application = createWorkspacePaneRuntimeApplication({
        worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
        physicalWorktrees: testPhysicalWorktrees,
        terminalWorktree: { listSessionsForUser: async () => [] },
        terminal: { createAdmitted: create, close },
        workspaceTabsCoordinator: { ensureRuntimeTabForSession },
        isCurrentWorkspaceRuntime,
        broadcastWorkspaceTabsChanged,
      })

      const open = application.open('client-test', 'user-test', { runtimeType: 'terminal', request })
      await vi.waitFor(() => expect(create).toHaveBeenCalledOnce())
      expect(current).toBe(true)
      providerResult.resolve(runtime)
      await expect(open).resolves.toEqual(stale)
      expect(current).toBe(false)
      expect(isCurrentWorkspaceRuntime).toHaveBeenCalledTimes(2)
      expect(ensureRuntimeTabForSession).toHaveBeenCalledOnce()
      expect(retire).toHaveBeenCalledTimes(action === 'created' ? 1 : 0)
      expect(close).not.toHaveBeenCalled()
      expect(broadcastWorkspaceTabsChanged).not.toHaveBeenCalled()
    },
  )

  test('closes a terminal by durable session id and leaves projection cleanup to the close event', async () => {
    const session = terminalSession('term-111111111111111111111', 'pty_session_1_aaaaaaaaa')
    const close = vi.fn(() => true)
    const broadcastWorkspaceTabsChanged = vi.fn()
    const listSessions = vi.fn().mockResolvedValueOnce([session])
    const application = createWorkspacePaneRuntimeApplication({
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      physicalWorktrees: testPhysicalWorktrees,
      terminalWorktree: { listSessionsForUser: listSessions },
      terminal: { createAdmitted: async () => terminalCreateSuccess(), close },
      workspaceTabsCoordinator: { ensureRuntimeTabForSession: vi.fn() },
      isCurrentWorkspaceRuntime: () => true,
      broadcastWorkspaceTabsChanged,
    })

    await expect(
      application.close('client-test', 'user-test', {
        runtimeType: 'terminal',
        sessionId: session.terminalSessionId,
        target: {
          target: request.target,
        },
      }),
    ).resolves.toEqual({
      ok: true,
      runtimeType: 'terminal',
      runtime: {
        action: 'closed',
        terminalSessionId: session.terminalSessionId,
        terminalRuntimeSessionId: session.terminalRuntimeSessionId,
        terminalRuntimeGeneration: session.terminalRuntimeGeneration,
      },
    })
    expect(close).toHaveBeenCalledWith('client-test', 'user-test', {
      terminalRuntimeSessionId: session.terminalRuntimeSessionId,
    })
    expect(broadcastWorkspaceTabsChanged).not.toHaveBeenCalled()
  })

  test('reports an already-closed durable identity without redundant projection reconciliation', async () => {
    const close = vi.fn()
    const application = createWorkspacePaneRuntimeApplication({
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      physicalWorktrees: testPhysicalWorktrees,
      terminalWorktree: { listSessionsForUser: async () => [] },
      terminal: { createAdmitted: async () => terminalCreateSuccess(), close },
      workspaceTabsCoordinator: { ensureRuntimeTabForSession: vi.fn() },
      isCurrentWorkspaceRuntime: () => true,
      broadcastWorkspaceTabsChanged: vi.fn(),
    })

    await expect(
      application.close('client-test', 'user-test', {
        runtimeType: 'terminal',
        sessionId: 'term-closedclosedclosed001',
        target: {
          target: request.target,
        },
      }),
    ).resolves.toEqual({
      ok: true,
      runtimeType: 'terminal',
      runtime: {
        action: 'already-closed',
        terminalSessionId: 'term-closedclosedclosed001',
        terminalRuntimeSessionId: null,
        terminalRuntimeGeneration: null,
      },
    })
    expect(close).not.toHaveBeenCalled()
  })

  test('does not close a same-path terminal owned by a different execution target', async () => {
    const workspaceTarget = {
      kind: 'workspace-root' as const,
      workspaceId,
      workspaceRuntimeId: request.workspaceRuntimeId,
    }
    const primaryWorktreeTarget = {
      kind: 'git-worktree' as const,
      workspaceId,
      workspaceRuntimeId: request.workspaceRuntimeId,
      root: workspaceId,
    }
    const session = {
      ...terminalSession('term-targettargettarget001', 'pty_target_aaaaaaaaaaaa'),
      target: primaryWorktreeTarget,
      presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: 'main' } },
      worktreePath: '/repo',
    }
    const close = vi.fn(() => true)
    const application = createWorkspacePaneRuntimeApplication({
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      physicalWorktrees: {
        capture: async () => testPhysicalWorktreeExecutionCapability('/repo'),
      },
      terminalWorktree: { listSessionsForUser: async () => [session] },
      terminal: { createAdmitted: async () => terminalCreateSuccess(), close },
      workspaceTabsCoordinator: { ensureRuntimeTabForSession: vi.fn() },
      isCurrentWorkspaceRuntime: () => true,
      broadcastWorkspaceTabsChanged: vi.fn(),
    })

    await expect(
      application.close('client-test', 'user-test', {
        runtimeType: 'terminal',
        sessionId: session.terminalSessionId,
        target: { target: workspaceTarget },
      }),
    ).resolves.toEqual({ ok: false, runtimeType: 'terminal', message: 'error.workspace-runtime-stale' })
    expect(close).not.toHaveBeenCalled()
  })

  test.each([
    {
      name: 'workspace runtime',
      sessionTarget: { ...request.target, workspaceRuntimeId: 'repo-runtime-other' },
    },
    {
      name: 'worktree root',
      sessionTarget: {
        ...request.target,
        root: otherWorktreeRoot,
      },
    },
  ])('does not close a durable terminal with a mismatched $name', async ({ sessionTarget }) => {
    const session = {
      ...terminalSession('term-targettargettarget002', 'pty_target_bbbbbbbbbbbb'),
      target: sessionTarget,
      presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: 'main' } },
    }
    const close = vi.fn(() => true)
    const application = createWorkspacePaneRuntimeApplication({
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      physicalWorktrees: {
        capture: async () => testPhysicalWorktreeExecutionCapability(request.worktreePath),
      },
      terminalWorktree: { listSessionsForUser: async () => [session] },
      terminal: { createAdmitted: async () => terminalCreateSuccess(), close },
      workspaceTabsCoordinator: { ensureRuntimeTabForSession: vi.fn() },
      isCurrentWorkspaceRuntime: () => true,
      broadcastWorkspaceTabsChanged: vi.fn(),
    })

    await expect(
      application.close('client-test', 'user-test', {
        runtimeType: 'terminal',
        sessionId: session.terminalSessionId,
        target: { target: request.target },
      }),
    ).resolves.toEqual({ ok: false, runtimeType: 'terminal', message: 'error.workspace-runtime-stale' })
    expect(close).not.toHaveBeenCalled()
  })

  test('does not claim runtime close success or mutate tabs when provider close is unconfirmed', async () => {
    const session = terminalSession('term-111111111111111111111', 'pty_session_1_aaaaaaaaa')
    const application = createWorkspacePaneRuntimeApplication({
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      physicalWorktrees: testPhysicalWorktrees,
      terminalWorktree: { listSessionsForUser: async () => [session] },
      terminal: { createAdmitted: async () => terminalCreateSuccess(), close: async () => false },
      workspaceTabsCoordinator: { ensureRuntimeTabForSession: vi.fn() },
      isCurrentWorkspaceRuntime: () => true,
      broadcastWorkspaceTabsChanged: vi.fn(),
    })

    await expect(
      application.close('client-test', 'user-test', {
        runtimeType: 'terminal',
        sessionId: session.terminalSessionId,
        target: {
          target: request.target,
        },
      }),
    ).resolves.toEqual({ ok: false, runtimeType: 'terminal', message: 'error.unavailable' })
  })

  test('serializes open and close through the shared user/runtime/worktree queue', async () => {
    const createResult = deferred<Extract<ServerTerminalCreateResult, { ok: true }>>()
    const session = terminalSession('term-111111111111111111111', 'pty_session_1_aaaaaaaaa')
    const listSessions = vi.fn().mockResolvedValueOnce([session]).mockResolvedValueOnce([])
    const application = createWorkspacePaneRuntimeApplication({
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      physicalWorktrees: testPhysicalWorktrees,
      terminalWorktree: { listSessionsForUser: listSessions },
      terminal: {
        createAdmitted: async () => await createResult.promise,
        close: () => true,
      },
      workspaceTabsCoordinator: {
        ensureRuntimeTabForSession: async (input: { commitAdmission: (canonicalBranch: string) => void }) => {
          input.commitAdmission(request.branch)
          return { kind: 'committed' as const, snapshot: paneTabsSnapshot }
        },
      },
      isCurrentWorkspaceRuntime: () => true,
      broadcastWorkspaceTabsChanged: () => {},
    })

    const open = application.open('client-test', 'user-test', { runtimeType: 'terminal', request })
    const close = application.close('client-test', 'user-test', {
      runtimeType: 'terminal',
      sessionId: session.terminalSessionId,
      target: {
        target: request.target,
      },
    })
    await Promise.resolve()
    expect(listSessions).not.toHaveBeenCalled()

    createResult.resolve(terminalCreateSuccess())
    await expect(open).resolves.toMatchObject({ ok: true })
    await expect(close).resolves.toMatchObject({ ok: true })
    expect(listSessions).toHaveBeenCalledOnce()
  })

  test('lets an earlier admitted open finish before a later removal that fails validation', async () => {
    const worktreeOperations = createPhysicalWorktreeOperationCoordinator()
    const createResult = deferred<Extract<ServerTerminalCreateResult, { ok: true }>>()
    const create = vi.fn(async () => await createResult.promise)
    const close = vi.fn(async () => true)
    const application = createWorkspacePaneRuntimeApplication({
      worktreeOperations,
      physicalWorktrees: testPhysicalWorktrees,
      terminalWorktree: { listSessionsForUser: async () => [] },
      terminal: { createAdmitted: create, close },
      workspaceTabsCoordinator: {
        ensureRuntimeTabForSession: async (input: {
          physicalWorktreeCapability: ReturnType<typeof testPhysicalWorktreeExecutionCapability>
          permit: PhysicalWorktreeOperationPermit
          commitAdmission: (canonicalBranch: string) => void
        }) => {
          worktreeOperations.assertPermit(input.physicalWorktreeCapability, input.permit)
          input.commitAdmission(request.branch)
          return { kind: 'committed' as const, snapshot: paneTabsSnapshot }
        },
      },
      isCurrentWorkspaceRuntime: () => true,
      broadcastWorkspaceTabsChanged: vi.fn(),
    })

    const open = application.open('client-test', 'user-test', { runtimeType: 'terminal', request })
    const physicalWorktreeCapability = testPhysicalWorktreeExecutionCapability(request.worktreePath)
    await vi.waitFor(() => expect(create).toHaveBeenCalledOnce())
    const removal = worktreeOperations.runRemoval(physicalWorktreeCapability, async () => ({
      ok: false,
      message: 'validation failed',
    }))
    expect(worktreeOperations.isRemovalAdmitted(physicalWorktreeCapability)).toBe(true)

    createResult.resolve(terminalCreateSuccess())
    await expect(open).resolves.toMatchObject({ ok: true })
    await expect(removal).resolves.toEqual({
      admitted: true,
      value: { ok: false, message: 'validation failed' },
    })
    expect(close).not.toHaveBeenCalled()
  })

  test('does not call the terminal provider while physical removal is admitted', async () => {
    const worktreeOperations = createPhysicalWorktreeOperationCoordinator()
    const physicalWorktreeCapability = testPhysicalWorktreeExecutionCapability(request.worktreePath)
    const removalGate = deferred<void>()
    const removal = worktreeOperations.runRemoval(physicalWorktreeCapability, async () => await removalGate.promise)
    const createAdmitted = vi.fn(async () => terminalCreateSuccess())
    const application = createWorkspacePaneRuntimeApplication({
      worktreeOperations,
      physicalWorktrees: { capture: async () => physicalWorktreeCapability },
      terminalWorktree: { listSessionsForUser: async () => [] },
      terminal: { createAdmitted, close: () => false },
      workspaceTabsCoordinator: { ensureRuntimeTabForSession: vi.fn() },
      isCurrentWorkspaceRuntime: () => true,
      broadcastWorkspaceTabsChanged: vi.fn(),
    })

    await expect(application.open('client-test', 'user-test', { runtimeType: 'terminal', request })).resolves.toEqual({
      ok: false,
      runtimeType: 'terminal',
      message: 'error.worktree-removal-in-progress',
    })
    expect(createAdmitted).not.toHaveBeenCalled()
    removalGate.resolve()
    await removal
  })

  test('retires an unpublished terminal if placement preparation throws', async () => {
    const runtime = terminalCreateSuccess()
    const retire = vi.fn()
    runtime.admission = { ...runtime.admission, kind: 'prepared', abort: retire }
    const close = vi.fn(async () => true)
    const broadcastWorkspaceTabsChanged = vi.fn()
    const application = createWorkspacePaneRuntimeApplication({
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      physicalWorktrees: testPhysicalWorktrees,
      terminalWorktree: { listSessionsForUser: async () => [] },
      terminal: { createAdmitted: async () => runtime, close },
      workspaceTabsCoordinator: {
        ensureRuntimeTabForSession: async () => {
          throw new Error('projection failed')
        },
      },
      isCurrentWorkspaceRuntime: () => true,
      broadcastWorkspaceTabsChanged,
    })

    await expect(application.open('client-test', 'user-test', { runtimeType: 'terminal', request })).resolves.toEqual({
      ok: false,
      runtimeType: 'terminal',
      message: 'error.unavailable',
    })
    expect(retire).toHaveBeenCalledOnce()
    expect(close).not.toHaveBeenCalled()
    expect(broadcastWorkspaceTabsChanged).not.toHaveBeenCalled()
  })

  test('preserves a typed final runtime-stale admission result', async () => {
    const runtime = terminalCreateSuccess()
    const abort = vi.fn()
    runtime.admission = { ...runtime.admission, kind: 'prepared', abort }
    const application = createWorkspacePaneRuntimeApplication({
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      physicalWorktrees: testPhysicalWorktrees,
      terminalWorktree: { listSessionsForUser: async () => [] },
      terminal: { createAdmitted: async () => runtime, close: () => false },
      workspaceTabsCoordinator: {
        ensureRuntimeTabForSession: async () => {
          throw new WorkspacePaneRuntimeStaleError()
        },
      },
      isCurrentWorkspaceRuntime: () => true,
      broadcastWorkspaceTabsChanged: vi.fn(),
    })

    await expect(application.open('client-test', 'user-test', { runtimeType: 'terminal', request })).resolves.toEqual({
      ok: false,
      runtimeType: 'terminal',
      message: 'error.workspace-runtime-stale',
    })
    expect(abort).toHaveBeenCalledOnce()
  })

  test('surfaces target identity changes as a distinct fast-fail', async () => {
    const runtime = terminalCreateSuccess()
    const abort = vi.fn()
    runtime.admission = { ...runtime.admission, kind: 'prepared', abort }
    const application = createWorkspacePaneRuntimeApplication({
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      physicalWorktrees: testPhysicalWorktrees,
      terminalWorktree: { listSessionsForUser: async () => [] },
      terminal: { createAdmitted: async () => runtime, close: () => false },
      workspaceTabsCoordinator: { ensureRuntimeTabForSession: async () => ({ kind: 'target-stale' }) },
      isCurrentWorkspaceRuntime: () => true,
      broadcastWorkspaceTabsChanged: vi.fn(),
    })

    await expect(application.open('client-test', 'user-test', { runtimeType: 'terminal', request })).resolves.toEqual({
      ok: false,
      runtimeType: 'terminal',
      message: 'error.workspace-target-stale',
    })
    expect(abort).toHaveBeenCalledOnce()
  })

  test('does not compensate an invariant failure after admission', async () => {
    const runtime = terminalCreateSuccess()
    const publish = vi.fn(() => committedTerminalResult('created'))
    const retire = vi.fn()
    const publishCommittedEffects = vi.fn()
    runtime.admission = { kind: 'prepared', commit: publish, publishCommittedEffects, abort: retire }
    const close = vi.fn(async () => true)
    const broadcastWorkspaceTabsChanged = vi.fn()
    const application = createWorkspacePaneRuntimeApplication({
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      physicalWorktrees: testPhysicalWorktrees,
      terminalWorktree: { listSessionsForUser: async () => [] },
      terminal: { createAdmitted: async () => runtime, close },
      workspaceTabsCoordinator: {
        ensureRuntimeTabForSession: async (input: { commitAdmission: (canonicalBranch: string) => void }) => {
          input.commitAdmission(request.branch)
          throw new Error('invariant failure after admission')
        },
      },
      isCurrentWorkspaceRuntime: () => true,
      broadcastWorkspaceTabsChanged,
    })

    await expect(application.open('client-test', 'user-test', { runtimeType: 'terminal', request })).resolves.toEqual({
      ok: false,
      runtimeType: 'terminal',
      message: 'error.unavailable',
    })
    expect(publish).toHaveBeenCalledOnce()
    expect(retire).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
    expect(publishCommittedEffects).not.toHaveBeenCalled()
    expect(broadcastWorkspaceTabsChanged).not.toHaveBeenCalled()
  })
})

function terminalCreateSuccess(
  action: 'created' | 'restored' | 'reused' = 'created',
): Extract<ServerTerminalCreateResult, { ok: true }> {
  const terminalRuntimeSessionId = 'pty_session_1_aaaaaaaaa'
  const terminalSessionId = 'term-111111111111111111111'
  return {
    ok: true,
    terminalSessionId,
    admission: {
      kind: 'existing',
      commit: () => committedTerminalResult(action),
      publishCommittedEffects: vi.fn(),
      abort: vi.fn(),
    },
    terminalRuntimeSessionId,
  }
}

function committedTerminalResult(action: 'created' | 'restored' | 'reused') {
  return {
    action,
    presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: request.branch } },
    terminalProjectionEffect: { kind: 'delta' as const, revision: 1 },
    terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
    terminalRuntimeGeneration: 1,
    processName: 'zsh',
    canonicalTitle: null,
    phase: 'open' as const,
    message: null,
    controller: { clientId: 'client-test', status: 'connected' as const },
    canonicalCols: 100,
    canonicalRows: 30,
  }
}

function publishedTerminalResult(
  runtime: Extract<ServerTerminalCreateResult, { ok: true }>,
): Extract<TerminalCreateResult, { ok: true }> {
  return {
    ok: true,
    terminalSessionId: runtime.terminalSessionId,
    ...runtime.admission.commit({
      presentation: { kind: 'git-worktree', head: { kind: 'branch' as const, branchName: request.branch } },
    }),
  }
}

function terminalSession(terminalSessionId: string, terminalRuntimeSessionId: string) {
  return {
    terminalRuntimeSessionId,
    terminalRuntimeGeneration: 1,
    terminalSessionId,
    target: request.target,
    presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: request.branch } },
    nativeWorktreePath: request.worktreePath,
    controller: { clientId: 'client-test', status: 'connected' as const },
    processName: 'zsh',
    canonicalTitle: null,
    phase: 'open' as const,
    message: null,
    cols: 100,
    rows: 30,
  }
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}
