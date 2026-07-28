import { describe, expect, test, vi } from 'vitest'
import { RemoteWorkspaceRuntimeFailureError } from '#/server/modules/remote-workspace-runtime-failure.ts'
import type * as RemoteWorkspaceFailureSettlement from '#/server/modules/remote-workspace-runtime-failure-settlement.ts'
import type * as WorkspaceRuntimesModule from '#/server/modules/workspace-runtimes.ts'
import {
  paneTabsSnapshot,
  publishedTerminalResult,
  request,
  runtimeTabsCoordinator,
  terminalCreateSuccess,
  terminalSession,
  deferred,
  workspaceId,
} from '#/server/test-utils/workspace-pane-runtime-application.ts'
import {
  testPhysicalWorktreeExecutionCapability,
  testPhysicalWorktrees,
} from '#/server/test-utils/physical-worktree-identity.ts'
import type { ServerTerminalCreateResult } from '#/server/terminal/terminal-session-creator.ts'
import { createWorkspacePaneRuntimeApplication } from '#/server/workspace-pane/workspace-pane-runtime-application.ts'
import { createPhysicalWorktreeOperationCoordinator } from '#/server/worktree-removal/physical-worktree-operation-coordinator.ts'
import type { WorkspaceProbeState } from '#/shared/workspace-runtime.ts'

const failRemoteWorkspaceRuntimeIfNeededMock = vi.hoisted(() => vi.fn())
const workspaceProbeStateForRuntimeMock = vi.hoisted(() =>
  vi.fn<() => WorkspaceProbeState>(() => ({
    status: 'ready' as const,
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

describe('open admission', () => {
  test('rejects runtime commands when the calling client no longer owns the workspace membership', async () => {
    const isCurrentWorkspaceRuntimeMembership = vi.fn(() => false)
    const capture = vi.fn()
    const application = createWorkspacePaneRuntimeApplication({
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      physicalWorktrees: { capture },
      terminalSessions: { listSessionsForUser: async () => [] },
      terminal: { createAdmitted: vi.fn(), close: vi.fn() },
      workspaceTabsCoordinator: runtimeTabsCoordinator({ ensureRuntimeTabForSession: vi.fn() }),
      isCurrentWorkspaceRuntimeMembership,
      broadcastWorkspaceTabsChanged: vi.fn(),
    })

    await expect(application.open('client-test', 'user-test', { runtimeType: 'terminal', request })).resolves.toEqual({
      ok: false,
      runtimeType: 'terminal',
      message: 'error.workspace-runtime-stale',
    })
    await expect(
      application.close('client-test', 'user-test', {
        runtimeType: 'terminal',
        target: { target: request.target },
        sessionId: 'term-111111111111111111111',
      }),
    ).resolves.toEqual({
      ok: false,
      runtimeType: 'terminal',
      message: 'error.workspace-runtime-stale',
    })
    expect(isCurrentWorkspaceRuntimeMembership).toHaveBeenCalledWith(
      'user-test',
      request.target.workspaceId,
      request.target.workspaceRuntimeId,
      'client-test',
    )
    expect(capture).not.toHaveBeenCalled()
  })

  test('rejects terminal creation from an unavailable authoritative capability', async () => {
    workspaceProbeStateForRuntimeMock.mockReturnValueOnce({
      status: 'ready',
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
      terminalSessions: { listSessionsForUser: async () => [] },
      terminal: { createAdmitted, close: () => ({ kind: 'failed' as const }) },
      workspaceTabsCoordinator: runtimeTabsCoordinator({ ensureRuntimeTabForSession: vi.fn() }),
      isCurrentWorkspaceRuntimeMembership: () => true,
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
      terminalSessions: { listSessionsForUser: async () => [] },
      terminal: { createAdmitted: vi.fn(), close: () => ({ kind: 'failed' as const }) },
      workspaceTabsCoordinator: runtimeTabsCoordinator({ ensureRuntimeTabForSession: vi.fn() }),
      isCurrentWorkspaceRuntimeMembership: () => true,
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
        capabilities: {
          files: { read: true, write: true },
          terminal: { available: true },
          git: { status: 'unavailable' },
        },
        diagnostics: [],
      })
      .mockReturnValueOnce({
        status: 'ready',
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
      terminalSessions: { listSessionsForUser: async () => [] },
      terminal: { createAdmitted, close: () => ({ kind: 'failed' as const }) },
      workspaceTabsCoordinator: runtimeTabsCoordinator({ ensureRuntimeTabForSession: vi.fn() }),
      isCurrentWorkspaceRuntimeMembership: () => true,
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
    const canonicalBranch = 'feature/renamed'
    const create = vi.fn(async () => runtime)
    const physicalWorktreeCapability = testPhysicalWorktreeExecutionCapability(request.worktreePath)
    const capture = vi.fn(async () => physicalWorktreeCapability)
    const ensureRuntimeTabForSession = vi.fn(async (input: { commitAdmission: (canonicalBranch: string) => void }) => {
      input.commitAdmission(canonicalBranch)
      return { kind: 'committed' as const, snapshot: paneTabsSnapshot }
    })
    const broadcastWorkspaceTabsChanged = vi.fn()
    const application = createWorkspacePaneRuntimeApplication({
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      physicalWorktrees: { capture },
      terminalSessions: { listSessionsForUser: async () => [] },
      terminal: { createAdmitted: create, close: () => ({ kind: 'failed' as const }) },
      workspaceTabsCoordinator: runtimeTabsCoordinator({ ensureRuntimeTabForSession }),
      isCurrentWorkspaceRuntimeMembership: () => true,
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
    expect(runtime.admission.commit).toHaveBeenCalledWith({
      presentation: { kind: 'git-worktree', head: { kind: 'branch', branchName: canonicalBranch } },
    })
    expect(runtime.admission.commit).toHaveBeenCalledOnce()
    expect(result).toEqual({
      ok: true,
      runtimeType: 'terminal',
      runtime: publishedTerminalResult(runtime, canonicalBranch),
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
      terminalSessions: { listSessionsForUser: async () => [] },
      terminal: {
        createAdmitted: async () => ({ ok: false, message: 'error.terminal-create-failed' }),
        close: () => ({ kind: 'failed' as const }),
      },
      workspaceTabsCoordinator: runtimeTabsCoordinator({ ensureRuntimeTabForSession }),
      isCurrentWorkspaceRuntimeMembership: () => true,
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
      terminalSessions: { listSessionsForUser: async () => [] },
      terminal: { createAdmitted, close: () => ({ kind: 'failed' as const }) },
      workspaceTabsCoordinator: runtimeTabsCoordinator({ ensureRuntimeTabForSession: vi.fn() }),
      isCurrentWorkspaceRuntimeMembership: () => true,
      broadcastWorkspaceTabsChanged: vi.fn(),
    })

    await application.open('client-test', 'user-test', { runtimeType: 'terminal', request: workspaceRequest })

    expect(capture).toHaveBeenCalledWith(expect.objectContaining({ workspaceId, worktreePath: '/repo' }))
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
    const close = vi.fn(() => ({ kind: 'closed' as const }))
    const application = createWorkspacePaneRuntimeApplication({
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      physicalWorktrees: {
        capture: async () => testPhysicalWorktreeExecutionCapability('/repo'),
      },
      terminalSessions: {
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
      workspaceTabsCoordinator: runtimeTabsCoordinator({
        ensureRuntimeTabForSession: vi.fn(),
        reconcileWorktreeAdmitted: vi.fn(async () => paneTabsSnapshot),
      }),
      isCurrentWorkspaceRuntimeMembership: () => true,
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

  test('does not close a terminal when membership is released while reading the session projection', async () => {
    const session = terminalSession('term-111111111111111111111', 'pty_session_1_aaaaaaaaa')
    const sessions = deferred<(typeof session)[]>()
    const sessionsReadStarted = deferred<void>()
    let current = true
    const close = vi.fn(() => ({ kind: 'closed' as const }))
    const application = createWorkspacePaneRuntimeApplication({
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      physicalWorktrees: testPhysicalWorktrees,
      terminalSessions: {
        listSessionsForUser: async () => {
          sessionsReadStarted.resolve()
          return await sessions.promise
        },
      },
      terminal: { createAdmitted: async () => ({ ok: false, message: 'unexpected' }), close },
      workspaceTabsCoordinator: runtimeTabsCoordinator({ ensureRuntimeTabForSession: vi.fn() }),
      isCurrentWorkspaceRuntimeMembership: () => current,
      broadcastWorkspaceTabsChanged: vi.fn(),
    })

    const closing = application.close('client-test', 'user-test', {
      runtimeType: 'terminal',
      sessionId: session.terminalSessionId,
      target: { target: request.target },
    })
    await sessionsReadStarted.promise
    current = false
    sessions.resolve([session])

    await expect(closing).resolves.toEqual({
      ok: false,
      runtimeType: 'terminal',
      message: 'error.workspace-runtime-stale',
    })
    expect(close).not.toHaveBeenCalled()
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
      terminalSessions: { listSessionsForUser: async () => [] },
      terminal: { createAdmitted: create, close: () => ({ kind: 'failed' as const }) },
      workspaceTabsCoordinator: runtimeTabsCoordinator({ ensureRuntimeTabForSession }),
      isCurrentWorkspaceRuntimeMembership: () => true,
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

  test.each(['created', 'reused', 'restored'] as const)(
    'rechecks workspace runtime authority at the tab commit boundary for a %s terminal',
    async (action) => {
      const runtime = terminalCreateSuccess(action)
      const retire = vi.fn()
      runtime.admission =
        action === 'created'
          ? { ...runtime.admission, kind: 'prepared', abort: retire }
          : { ...runtime.admission, kind: 'existing', abort: vi.fn() }
      const close = vi.fn(() => ({ kind: 'closed' as const }))
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
      const isCurrentWorkspaceRuntimeMembership = vi.fn(() => current)
      const application = createWorkspacePaneRuntimeApplication({
        worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
        physicalWorktrees: testPhysicalWorktrees,
        terminalSessions: { listSessionsForUser: async () => [] },
        terminal: { createAdmitted: create, close },
        workspaceTabsCoordinator: runtimeTabsCoordinator({ ensureRuntimeTabForSession }),
        isCurrentWorkspaceRuntimeMembership,
        broadcastWorkspaceTabsChanged,
      })

      const open = application.open('client-test', 'user-test', { runtimeType: 'terminal', request })
      await vi.waitFor(() => expect(create).toHaveBeenCalledOnce())
      expect(current).toBe(true)
      providerResult.resolve(runtime)
      await expect(open).resolves.toEqual(stale)
      expect(current).toBe(false)
      expect(isCurrentWorkspaceRuntimeMembership).toHaveBeenCalledTimes(3)
      expect(ensureRuntimeTabForSession).toHaveBeenCalledOnce()
      expect(retire).toHaveBeenCalledTimes(action === 'created' ? 1 : 0)
      expect(close).not.toHaveBeenCalled()
      expect(broadcastWorkspaceTabsChanged).not.toHaveBeenCalled()
    },
  )
})
