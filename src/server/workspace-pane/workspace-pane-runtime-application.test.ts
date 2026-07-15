import { describe, expect, test, vi } from 'vitest'
import { createWorkspacePaneRuntimeApplication } from '#/server/workspace-pane/workspace-pane-runtime-application.ts'
import type { TerminalCreateResult } from '#/shared/terminal-types.ts'
import type { WorkspacePaneTabsCoordinator } from '#/server/workspace-pane/workspace-pane-tabs-coordinator.ts'
import type { WorkspacePaneTabsSnapshot } from '#/shared/workspace-pane-tabs.ts'
import {
  createPhysicalWorktreeOperationCoordinator,
  type PhysicalWorktreeOperationPermit,
} from '#/server/worktree-removal/physical-worktree-operation-coordinator.ts'
import {
  issueTestPhysicalWorktreeCapability,
  testPhysicalWorktreeCapability,
  testPhysicalWorktreeIdentity,
  testPhysicalWorktrees,
} from '#/server/test-utils/physical-worktree-identity.ts'
import { RemoteRepoRuntimeFailureError } from '#/server/modules/remote-runtime-failure.ts'

const failRemoteRuntimeIfNeededMock = vi.hoisted(() => vi.fn())
vi.mock('#/server/modules/remote-runtime-failure-settlement.ts', async (importActual) => {
  const actual = await importActual<typeof import('#/server/modules/remote-runtime-failure-settlement.ts')>()
  return { ...actual, failRemoteRuntimeIfNeeded: failRemoteRuntimeIfNeededMock }
})

const request = {
  repoRoot: '/repo',
  repoRuntimeId: 'repo-runtime-test',
  branch: 'main',
  worktreePath: '/repo/worktree',
  kind: 'primary' as const,
  cols: 100,
  rows: 30,
  clientId: 'client-test',
}

describe('WorkspacePaneRuntimeApplication', () => {
  test('returns the provider result and canonical tabs as one application outcome', async () => {
    const runtime = terminalCreateSuccess()
    const create = vi.fn(async () => runtime)
    const physicalWorktreeCapability = testPhysicalWorktreeCapability(request.worktreePath)
    const capture = vi.fn(async () => physicalWorktreeCapability)
    const workspacePaneTabs = snapshot([
      { type: 'status', tabId: 'workspace-pane:status' },
      { type: 'terminal', runtimeSessionId: runtime.terminalSessionId },
    ])
    const ensureRuntimeTabForSession = vi.fn(async () => ({ kind: 'committed' as const, snapshot: workspacePaneTabs }))
    const broadcastWorkspaceTabsChanged = vi.fn()
    const application = createWorkspacePaneRuntimeApplication({
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      physicalWorktrees: { capture },
      terminalWorktree: { listSessionsForUser: async () => [] },
      terminal: { createAdmitted: create, close: () => false },
      workspaceTabsCoordinator: { ensureRuntimeTabForSession, reconcileWorktreeAdmitted: vi.fn() } as unknown as Pick<
        WorkspacePaneTabsCoordinator,
        'ensureRuntimeTabForSession' | 'reconcileWorktreeAdmitted'
      >,
      isCurrentRepoRuntime: () => true,
      broadcastWorkspaceTabsChanged,
    })

    const result = await application.open('client-test', 'user-test', {
      runtimeType: 'terminal',
      request,
      insertAfterIdentity: 'workspace-pane:status',
    })

    expect(capture).toHaveBeenCalledOnce()
    expect(create).toHaveBeenCalledWith('client-test', 'user-test', request, {
      physicalWorktreeCapability,
      permit: expect.any(Object),
    })
    expect(ensureRuntimeTabForSession).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-test',
        repoRoot: '/repo',
        scope: '/repo\0repo-runtime-test',
        branchName: 'main',
        worktreePath: '/repo/worktree',
        runtimeType: 'terminal',
        sessionId: runtime.terminalSessionId,
        insertAfterIdentity: 'workspace-pane:status',
      }),
    )
    expect(result).toEqual({
      ok: true,
      runtimeType: 'terminal',
      runtime,
      workspacePaneTabs,
    })
    expect(broadcastWorkspaceTabsChanged).toHaveBeenCalledWith('user-test', '/repo')
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
      workspaceTabsCoordinator: { ensureRuntimeTabForSession, reconcileWorktreeAdmitted: vi.fn() } as unknown as Pick<
        WorkspacePaneTabsCoordinator,
        'ensureRuntimeTabForSession' | 'reconcileWorktreeAdmitted'
      >,
      isCurrentRepoRuntime: () => true,
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

  test('reports remote runtime failure when physical worktree capture proves transport failure', async () => {
    const failure = new RemoteRepoRuntimeFailureError({
      repoRoot: request.repoRoot,
      repoRuntimeId: request.repoRuntimeId,
      reason: 'unreachable',
    })
    const create = vi.fn()
    const ensureRuntimeTabForSession = vi.fn()
    failRemoteRuntimeIfNeededMock.mockClear()
    const application = createWorkspacePaneRuntimeApplication({
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      physicalWorktrees: { capture: async () => { throw failure } },
      terminalWorktree: { listSessionsForUser: async () => [] },
      terminal: { createAdmitted: create, close: () => false },
      workspaceTabsCoordinator: { ensureRuntimeTabForSession, reconcileWorktreeAdmitted: vi.fn() } as unknown as Pick<
        WorkspacePaneTabsCoordinator,
        'ensureRuntimeTabForSession' | 'reconcileWorktreeAdmitted'
      >,
      isCurrentRepoRuntime: () => true,
      broadcastWorkspaceTabsChanged: vi.fn(),
    })

    await expect(application.open('client-test', 'user-test', { runtimeType: 'terminal', request })).resolves.toEqual({
      ok: false,
      runtimeType: 'terminal',
      message: 'unreachable',
    })
    expect(failRemoteRuntimeIfNeededMock).toHaveBeenCalledWith('user-test', failure)
    expect(create).not.toHaveBeenCalled()
    expect(ensureRuntimeTabForSession).not.toHaveBeenCalled()
  })

  test('reports remote runtime failure when queued physical validation proves transport failure', async () => {
    const failure = new RemoteRepoRuntimeFailureError({
      repoRoot: request.repoRoot,
      repoRuntimeId: request.repoRuntimeId,
      reason: 'unreachable',
      message: 'connection refused',
    })
    const capability = issueTestPhysicalWorktreeCapability({
      identity: testPhysicalWorktreeIdentity(request.worktreePath),
      validateExecution: async () => { throw failure },
    })
    const create = vi.fn()
    const ensureRuntimeTabForSession = vi.fn()
    failRemoteRuntimeIfNeededMock.mockClear()
    const application = createWorkspacePaneRuntimeApplication({
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      physicalWorktrees: { capture: async () => capability },
      terminalWorktree: { listSessionsForUser: async () => [] },
      terminal: { createAdmitted: create, close: () => false },
      workspaceTabsCoordinator: { ensureRuntimeTabForSession, reconcileWorktreeAdmitted: vi.fn() } as unknown as Pick<
        WorkspacePaneTabsCoordinator,
        'ensureRuntimeTabForSession' | 'reconcileWorktreeAdmitted'
      >,
      isCurrentRepoRuntime: () => true,
      broadcastWorkspaceTabsChanged: vi.fn(),
    })

    await expect(application.open('client-test', 'user-test', { runtimeType: 'terminal', request })).resolves.toEqual({
      ok: false,
      runtimeType: 'terminal',
      message: 'connection refused',
    })
    expect(failRemoteRuntimeIfNeededMock).toHaveBeenCalledWith('user-test', failure)
    expect(create).not.toHaveBeenCalled()
    expect(ensureRuntimeTabForSession).not.toHaveBeenCalled()
  })

  test.each(['created', 'reused', 'restored'] as const)(
    'rechecks repo runtime authority at the tab commit boundary for a %s terminal',
    async (action) => {
      const runtime = terminalCreateSuccess()
      runtime.action = action
      const close = vi.fn(() => true)
      const reconcileWorktree = vi.fn(async () => snapshot([]))
      const stale = { ok: false as const, runtimeType: 'terminal' as const, message: 'error.repo-runtime-stale' }
      const ensureRuntimeTabForSession = vi.fn(async (input: { isRuntimeCurrent: () => boolean }) =>
        input.isRuntimeCurrent()
          ? { kind: 'committed' as const, snapshot: snapshot([]) }
          : { kind: 'runtime-stale' as const })
      const broadcastWorkspaceTabsChanged = vi.fn()
      const providerResult = deferred<Extract<TerminalCreateResult, { ok: true }>>()
      let current = true
      const create = vi.fn(async () => {
        const result = await providerResult.promise
        current = false
        return result
      })
      const isCurrentRepoRuntime = vi.fn(() => current)
      const application = createWorkspacePaneRuntimeApplication({
        worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      physicalWorktrees: testPhysicalWorktrees,
        terminalWorktree: { listSessionsForUser: async () => [] },
        terminal: { createAdmitted: create, close },
        workspaceTabsCoordinator: { ensureRuntimeTabForSession, reconcileWorktreeAdmitted: reconcileWorktree } as unknown as Pick<
          WorkspacePaneTabsCoordinator,
          'ensureRuntimeTabForSession' | 'reconcileWorktreeAdmitted'
        >,
        isCurrentRepoRuntime,
        broadcastWorkspaceTabsChanged,
      })

      const open = application.open('client-test', 'user-test', { runtimeType: 'terminal', request })
      await vi.waitFor(() => expect(create).toHaveBeenCalledOnce())
      expect(current).toBe(true)
      providerResult.resolve(runtime)
      await expect(open).resolves.toEqual(stale)
      expect(current).toBe(false)
      expect(isCurrentRepoRuntime).toHaveBeenCalledTimes(2)
      expect(ensureRuntimeTabForSession).toHaveBeenCalledOnce()
      if (action === 'created') {
        expect(close).toHaveBeenCalledOnce()
        expect(close).toHaveBeenCalledWith('client-test', 'user-test', {
          terminalRuntimeSessionId: runtime.terminalRuntimeSessionId,
        })
      } else {
        expect(close).not.toHaveBeenCalled()
      }
      expect(reconcileWorktree).toHaveBeenCalledOnce()
      expect(broadcastWorkspaceTabsChanged).toHaveBeenCalledWith('user-test', request.repoRoot)
    },
  )

  test('reconciles provider truth when stale-open compensation is not acknowledged', async () => {
    const runtime = terminalCreateSuccess()
    const close = vi.fn(async () => false)
    const stale = { ok: false as const, runtimeType: 'terminal' as const, message: 'error.repo-runtime-stale' }
    const reconcileWorktree = vi.fn(async () =>
      snapshot([{ type: 'terminal', runtimeSessionId: runtime.terminalSessionId }]),
    )
    const broadcastWorkspaceTabsChanged = vi.fn()
    const providerResult = deferred<Extract<TerminalCreateResult, { ok: true }>>()
    let current = true
    const create = vi.fn(async () => {
      const result = await providerResult.promise
      current = false
      return result
    })
    const application = createWorkspacePaneRuntimeApplication({
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      physicalWorktrees: testPhysicalWorktrees,
      terminalWorktree: { listSessionsForUser: async () => [] },
      terminal: { createAdmitted: create, close },
      workspaceTabsCoordinator: {
        ensureRuntimeTabForSession: async (input: { isRuntimeCurrent: () => boolean }) =>
          input.isRuntimeCurrent()
            ? { kind: 'committed' as const, snapshot: snapshot([]) }
            : { kind: 'runtime-stale' as const },
        reconcileWorktreeAdmitted: reconcileWorktree,
      } as unknown as Pick<WorkspacePaneTabsCoordinator, 'ensureRuntimeTabForSession' | 'reconcileWorktreeAdmitted'>,
      isCurrentRepoRuntime: () => current,
      broadcastWorkspaceTabsChanged,
    })

    const open = application.open('client-test', 'user-test', { runtimeType: 'terminal', request })
    await vi.waitFor(() => expect(create).toHaveBeenCalledOnce())
    providerResult.resolve(runtime)
    await expect(open).resolves.toEqual(stale)
    expect(close).toHaveBeenCalledOnce()
    expect(reconcileWorktree).toHaveBeenCalledOnce()
    expect(broadcastWorkspaceTabsChanged).toHaveBeenCalledWith('user-test', request.repoRoot)
  })

  test('closes a terminal by durable session id and returns the canonical scope snapshot', async () => {
    const session = terminalSession('term-111111111111111111111', 'pty_session_1_aaaaaaaaa')
    const close = vi.fn(() => true)
    const workspacePaneTabs = snapshot([{ type: 'status', tabId: 'workspace-pane:status' }])
    const reconcileWorktree = vi.fn(async () => workspacePaneTabs)
    const broadcastWorkspaceTabsChanged = vi.fn()
    const listSessions = vi.fn().mockResolvedValueOnce([session])
    const application = createWorkspacePaneRuntimeApplication({
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      physicalWorktrees: testPhysicalWorktrees,
      terminalWorktree: { listSessionsForUser: listSessions },
      terminal: { createAdmitted: async () => terminalCreateSuccess(), close },
      workspaceTabsCoordinator: {
        ensureRuntimeTabForSession: vi.fn(),
        reconcileWorktreeAdmitted: reconcileWorktree,
      } as unknown as Pick<WorkspacePaneTabsCoordinator, 'ensureRuntimeTabForSession' | 'reconcileWorktreeAdmitted'>,
      isCurrentRepoRuntime: () => true,
      broadcastWorkspaceTabsChanged,
    })

    await expect(
      application.close('client-test', 'user-test', {
        runtimeType: 'terminal',
        sessionId: session.terminalSessionId,
        target: {
          repoRoot: request.repoRoot,
          repoRuntimeId: request.repoRuntimeId,
          branchName: request.branch,
          worktreePath: request.worktreePath,
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
      workspacePaneTabs,
    })
    expect(close).toHaveBeenCalledWith('client-test', 'user-test', {
      terminalRuntimeSessionId: session.terminalRuntimeSessionId,
    })
    expect(reconcileWorktree).toHaveBeenCalledWith({
      userId: 'user-test',
      repoRoot: request.repoRoot,
      scope: '/repo\0repo-runtime-test',
      worktreePath: request.worktreePath,
      physicalWorktreeCapability: expect.objectContaining({
        identity: testPhysicalWorktreeIdentity(request.worktreePath),
      }),
      permit: expect.objectContaining({ operationId: expect.any(Number) }),
    })
    expect(broadcastWorkspaceTabsChanged).toHaveBeenCalledWith('user-test', request.repoRoot)
  })

  test('reports an already-closed durable identity and still reconciles tabs', async () => {
    const close = vi.fn()
    const workspacePaneTabs = snapshot([{ type: 'status', tabId: 'workspace-pane:status' }])
    const reconcileWorktree = vi.fn(async () => workspacePaneTabs)
    const application = createWorkspacePaneRuntimeApplication({
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      physicalWorktrees: testPhysicalWorktrees,
      terminalWorktree: { listSessionsForUser: async () => [] },
      terminal: { createAdmitted: async () => terminalCreateSuccess(), close },
      workspaceTabsCoordinator: {
        ensureRuntimeTabForSession: vi.fn(),
        reconcileWorktreeAdmitted: reconcileWorktree,
      } as unknown as Pick<WorkspacePaneTabsCoordinator, 'ensureRuntimeTabForSession' | 'reconcileWorktreeAdmitted'>,
      isCurrentRepoRuntime: () => true,
      broadcastWorkspaceTabsChanged: vi.fn(),
    })

    await expect(
      application.close('client-test', 'user-test', {
        runtimeType: 'terminal',
        sessionId: 'term-closedclosedclosed001',
        target: {
          repoRoot: request.repoRoot,
          repoRuntimeId: request.repoRuntimeId,
          branchName: request.branch,
          worktreePath: request.worktreePath,
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
      workspacePaneTabs,
    })
    expect(close).not.toHaveBeenCalled()
    expect(reconcileWorktree).toHaveBeenCalledOnce()
  })

  test('does not claim runtime close success or mutate tabs when provider close is unconfirmed', async () => {
    const session = terminalSession('term-111111111111111111111', 'pty_session_1_aaaaaaaaa')
    const reconcileWorktree = vi.fn()
    const application = createWorkspacePaneRuntimeApplication({
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      physicalWorktrees: testPhysicalWorktrees,
      terminalWorktree: { listSessionsForUser: async () => [session] },
      terminal: { createAdmitted: async () => terminalCreateSuccess(), close: async () => false },
      workspaceTabsCoordinator: {
        ensureRuntimeTabForSession: vi.fn(),
        reconcileWorktreeAdmitted: reconcileWorktree,
      } as unknown as Pick<WorkspacePaneTabsCoordinator, 'ensureRuntimeTabForSession' | 'reconcileWorktreeAdmitted'>,
      isCurrentRepoRuntime: () => true,
      broadcastWorkspaceTabsChanged: vi.fn(),
    })

    await expect(
      application.close('client-test', 'user-test', {
        runtimeType: 'terminal',
        sessionId: session.terminalSessionId,
        target: {
          repoRoot: request.repoRoot,
          repoRuntimeId: request.repoRuntimeId,
          branchName: request.branch,
          worktreePath: request.worktreePath,
        },
      }),
    ).resolves.toEqual({ ok: false, runtimeType: 'terminal', message: 'error.unavailable' })
    expect(reconcileWorktree).not.toHaveBeenCalled()
  })

  test('serializes open and close through the shared user/runtime/worktree queue', async () => {
    const createResult = deferred<Extract<TerminalCreateResult, { ok: true }>>()
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
        ensureRuntimeTabForSession: async () => ({
          kind: 'committed' as const,
          snapshot: snapshot([{ type: 'terminal', runtimeSessionId: session.terminalSessionId }]),
        }),
        reconcileWorktreeAdmitted: async () => snapshot([]),
      } as unknown as Pick<WorkspacePaneTabsCoordinator, 'ensureRuntimeTabForSession' | 'reconcileWorktreeAdmitted'>,
      isCurrentRepoRuntime: () => true,
      broadcastWorkspaceTabsChanged: () => {},
    })

    const open = application.open('client-test', 'user-test', { runtimeType: 'terminal', request })
    const close = application.close('client-test', 'user-test', {
      runtimeType: 'terminal',
      sessionId: session.terminalSessionId,
      target: {
        repoRoot: request.repoRoot,
        repoRuntimeId: request.repoRuntimeId,
        branchName: request.branch,
        worktreePath: request.worktreePath,
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
    const createResult = deferred<Extract<TerminalCreateResult, { ok: true }>>()
    const create = vi.fn(async () => await createResult.promise)
    const close = vi.fn(async () => true)
    const application = createWorkspacePaneRuntimeApplication({
      worktreeOperations,
      physicalWorktrees: testPhysicalWorktrees,
      terminalWorktree: { listSessionsForUser: async () => [] },
      terminal: { createAdmitted: create, close },
      workspaceTabsCoordinator: {
        ensureRuntimeTabForSession: async (input: {
          physicalWorktreeCapability: ReturnType<typeof testPhysicalWorktreeCapability>
          permit: PhysicalWorktreeOperationPermit
        }) => {
          worktreeOperations.assertPermit(input.physicalWorktreeCapability, input.permit)
          return {
            kind: 'committed' as const,
            snapshot: snapshot([{ type: 'terminal', runtimeSessionId: 'term-111111111111111111111' }]),
          }
        },
        reconcileWorktreeAdmitted: vi.fn(),
      } as unknown as Pick<WorkspacePaneTabsCoordinator, 'ensureRuntimeTabForSession' | 'reconcileWorktreeAdmitted'>,
      isCurrentRepoRuntime: () => true,
      broadcastWorkspaceTabsChanged: vi.fn(),
    })

    const open = application.open('client-test', 'user-test', { runtimeType: 'terminal', request })
    const physicalWorktreeCapability = testPhysicalWorktreeCapability(request.worktreePath)
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
    const physicalWorktreeCapability = testPhysicalWorktreeCapability(request.worktreePath)
    const removalGate = deferred<void>()
    const removal = worktreeOperations.runRemoval(physicalWorktreeCapability, async () => await removalGate.promise)
    const createAdmitted = vi.fn(async () => terminalCreateSuccess())
    const application = createWorkspacePaneRuntimeApplication({
      worktreeOperations,
      physicalWorktrees: { capture: async () => physicalWorktreeCapability },
      terminalWorktree: { listSessionsForUser: async () => [] },
      terminal: { createAdmitted, close: () => false },
      workspaceTabsCoordinator: {
        ensureRuntimeTabForSession: vi.fn(),
        reconcileWorktreeAdmitted: vi.fn(),
      } as unknown as Pick<WorkspacePaneTabsCoordinator, 'ensureRuntimeTabForSession' | 'reconcileWorktreeAdmitted'>,
      isCurrentRepoRuntime: () => true,
      broadcastWorkspaceTabsChanged: vi.fn(),
    })

    await expect(
      application.open('client-test', 'user-test', { runtimeType: 'terminal', request }),
    ).resolves.toEqual({
      ok: false,
      runtimeType: 'terminal',
      message: 'error.worktree-removal-in-progress',
    })
    expect(createAdmitted).not.toHaveBeenCalled()
    removalGate.resolve()
    await removal
  })

  test('closes a newly created terminal and reconciles if projection unexpectedly throws', async () => {
    const runtime = terminalCreateSuccess()
    const close = vi.fn(async () => true)
    const reconcileWorktree = vi.fn(async () => snapshot([]))
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
        reconcileWorktreeAdmitted: reconcileWorktree,
      } as unknown as Pick<WorkspacePaneTabsCoordinator, 'ensureRuntimeTabForSession' | 'reconcileWorktreeAdmitted'>,
      isCurrentRepoRuntime: () => true,
      broadcastWorkspaceTabsChanged,
    })

    await expect(application.open('client-test', 'user-test', { runtimeType: 'terminal', request })).resolves.toEqual({
      ok: false,
      runtimeType: 'terminal',
      message: 'error.unavailable',
    })
    expect(close).toHaveBeenCalledWith('client-test', 'user-test', {
      terminalRuntimeSessionId: runtime.terminalRuntimeSessionId,
    })
    expect(reconcileWorktree).toHaveBeenCalledOnce()
    expect(broadcastWorkspaceTabsChanged).toHaveBeenCalledWith('user-test', request.repoRoot)
  })
})

function snapshot(tabs: WorkspacePaneTabsSnapshot['entries'][number]['tabs']): WorkspacePaneTabsSnapshot {
  return {
    revision: 1,
    entries: [
      {
        repoRoot: request.repoRoot,
        branchName: request.branch,
        worktreePath: request.worktreePath,
        tabs,
      },
    ],
  }
}

function terminalCreateSuccess(): Extract<TerminalCreateResult, { ok: true }> {
  const terminalRuntimeSessionId = 'pty_session_1_aaaaaaaaa'
  const terminalSessionId = 'term-111111111111111111111'
  return {
    ok: true,
    action: 'created',
    terminalSessionId,
    terminalSessionsRevision: 1,
    terminalRuntimeSessionId,
    terminalRuntimeGeneration: 1,
    processName: 'zsh',
    canonicalTitle: null,
    phase: 'open',
    message: null,
    snapshot: '',
    snapshotSeq: 0,
    outputEra: 0,
    controller: { clientId: 'client-test', status: 'connected' },
    canonicalCols: 100,
    canonicalRows: 30,
  }
}

function terminalSession(terminalSessionId: string, terminalRuntimeSessionId: string) {
  return {
    terminalRuntimeSessionId,
    terminalRuntimeGeneration: 1,
    terminalSessionId,
    repoRuntimeId: request.repoRuntimeId,
    repoRoot: request.repoRoot,
    branch: request.branch,
    worktreePath: request.worktreePath,
    cwd: request.worktreePath,
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
