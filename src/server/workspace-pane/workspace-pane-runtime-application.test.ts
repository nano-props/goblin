import { describe, expect, test, vi } from 'vitest'
import { createWorkspacePaneRuntimeApplication } from '#/server/workspace-pane/workspace-pane-runtime-application.ts'
import type { TerminalCreateResult } from '#/shared/terminal-types.ts'
import type { WorkspacePaneTabsCoordinator } from '#/server/workspace-pane/workspace-pane-tabs-coordinator.ts'
import type { WorkspacePaneTabsSnapshot } from '#/shared/workspace-pane-tabs.ts'
import {
  createPhysicalWorktreeOperationCoordinator,
  type PhysicalWorktreeOperationPermit,
} from '#/server/worktree-removal/physical-worktree-operation-coordinator.ts'

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
    const workspacePaneTabs = snapshot([
      { type: 'status', tabId: 'workspace-pane:status' },
      { type: 'terminal', runtimeSessionId: runtime.terminalSessionId },
    ])
    const ensureRuntimeTabForSession = vi.fn(async () => workspacePaneTabs)
    const broadcastWorkspaceTabsChanged = vi.fn()
    const application = createWorkspacePaneRuntimeApplication({
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      terminalWorktree: { listSessionsForUser: async () => [] },
      terminal: { create, close: () => false },
      workspaceTabsCoordinator: { ensureRuntimeTabForSession, reconcileWorktree: vi.fn() } as unknown as Pick<
        WorkspacePaneTabsCoordinator,
        'ensureRuntimeTabForSession' | 'reconcileWorktree'
      >,
      isCurrentRepoRuntime: () => true,
      broadcastWorkspaceTabsChanged,
    })

    const result = await application.open('client-test', 'user-test', {
      runtimeType: 'terminal',
      request,
      insertAfterIdentity: 'workspace-pane:status',
    })

    expect(create).toHaveBeenCalledWith('client-test', 'user-test', request)
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
      terminalWorktree: { listSessionsForUser: async () => [] },
      terminal: {
        create: async () => ({ ok: false, message: 'error.terminal-create-failed' }),
        close: () => false,
      },
      workspaceTabsCoordinator: { ensureRuntimeTabForSession, reconcileWorktree: vi.fn() } as unknown as Pick<
        WorkspacePaneTabsCoordinator,
        'ensureRuntimeTabForSession' | 'reconcileWorktree'
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

  test.each(['created', 'reused', 'restored'] as const)(
    'rechecks repo runtime authority at the tab commit boundary for a %s terminal',
    async (action) => {
      const runtime = terminalCreateSuccess()
      runtime.action = action
      const close = vi.fn(() => true)
      const reconcileWorktree = vi.fn(async () => snapshot([]))
      const stale = { ok: false as const, runtimeType: 'terminal' as const, message: 'error.repo-runtime-stale' }
      const ensureRuntimeTabForSession = vi.fn(async (input: { guardBeforeWrite?: () => typeof stale | null }) => {
        return input.guardBeforeWrite?.() ?? []
      })
      const broadcastWorkspaceTabsChanged = vi.fn()
      const application = createWorkspacePaneRuntimeApplication({
        worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
        terminalWorktree: { listSessionsForUser: async () => [] },
        terminal: { create: async () => runtime, close },
        workspaceTabsCoordinator: { ensureRuntimeTabForSession, reconcileWorktree } as unknown as Pick<
          WorkspacePaneTabsCoordinator,
          'ensureRuntimeTabForSession' | 'reconcileWorktree'
        >,
        isCurrentRepoRuntime: () => false,
        broadcastWorkspaceTabsChanged,
      })

      await expect(application.open('client-test', 'user-test', { runtimeType: 'terminal', request })).resolves.toEqual(
        stale,
      )
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
    const application = createWorkspacePaneRuntimeApplication({
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      terminalWorktree: { listSessionsForUser: async () => runtime.sessions },
      terminal: { create: async () => runtime, close },
      workspaceTabsCoordinator: {
        ensureRuntimeTabForSession: async (input: { guardBeforeWrite?: () => typeof stale | null }) =>
          input.guardBeforeWrite?.() ?? snapshot([]),
        reconcileWorktree,
      } as unknown as Pick<WorkspacePaneTabsCoordinator, 'ensureRuntimeTabForSession' | 'reconcileWorktree'>,
      isCurrentRepoRuntime: () => false,
      broadcastWorkspaceTabsChanged,
    })

    await expect(application.open('client-test', 'user-test', { runtimeType: 'terminal', request })).resolves.toEqual(
      stale,
    )
    expect(close).toHaveBeenCalledOnce()
    expect(reconcileWorktree).toHaveBeenCalledOnce()
    expect(broadcastWorkspaceTabsChanged).toHaveBeenCalledWith('user-test', request.repoRoot)
  })

  test('returns terminal sessions in the canonical workspace tab order', async () => {
    const runtime = terminalCreateSuccess()
    const first = terminalSession('term-333333333333333333333', 'pty_session_3_aaaaaaaaa')
    const second = terminalSession('term-222222222222222222222', 'pty_session_2_aaaaaaaaa')
    const created = terminalSession(runtime.terminalSessionId, runtime.terminalRuntimeSessionId)
    runtime.sessions = [first, second, created]
    const tabs = [
      { type: 'terminal' as const, runtimeSessionId: first.terminalSessionId },
      { type: 'terminal' as const, runtimeSessionId: created.terminalSessionId },
      { type: 'terminal' as const, runtimeSessionId: second.terminalSessionId },
    ]
    const application = createWorkspacePaneRuntimeApplication({
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      terminalWorktree: { listSessionsForUser: async () => [] },
      terminal: { create: async () => runtime, close: () => false },
      workspaceTabsCoordinator: {
        ensureRuntimeTabForSession: async () => snapshot(tabs),
        reconcileWorktree: vi.fn(),
      } as unknown as Pick<WorkspacePaneTabsCoordinator, 'ensureRuntimeTabForSession' | 'reconcileWorktree'>,
      isCurrentRepoRuntime: () => true,
      broadcastWorkspaceTabsChanged: () => {},
    })

    const result = await application.open('client-test', 'user-test', {
      runtimeType: 'terminal',
      request,
      insertAfterIdentity: `terminal:${first.terminalSessionId}`,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.workspacePaneTabs).toEqual(snapshot(tabs))
    expect(result.runtime.sessions.map((session) => session.terminalSessionId)).toEqual([
      first.terminalSessionId,
      created.terminalSessionId,
      second.terminalSessionId,
    ])
  })

  test('closes a terminal by durable session id and returns the canonical scope snapshot', async () => {
    const session = terminalSession('term-111111111111111111111', 'pty_session_1_aaaaaaaaa')
    const close = vi.fn(() => true)
    const workspacePaneTabs = snapshot([{ type: 'status', tabId: 'workspace-pane:status' }])
    const reconcileWorktree = vi.fn(async () => workspacePaneTabs)
    const broadcastWorkspaceTabsChanged = vi.fn()
    const listSessions = vi.fn().mockResolvedValueOnce([session]).mockResolvedValueOnce([])
    const application = createWorkspacePaneRuntimeApplication({
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      terminalWorktree: { listSessionsForUser: listSessions },
      terminal: { create: async () => terminalCreateSuccess(), close },
      workspaceTabsCoordinator: {
        ensureRuntimeTabForSession: vi.fn(),
        reconcileWorktree,
      } as unknown as Pick<WorkspacePaneTabsCoordinator, 'ensureRuntimeTabForSession' | 'reconcileWorktree'>,
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
    ).resolves.toEqual({ ok: true, runtimeType: 'terminal', runtime: { sessions: [] }, workspacePaneTabs })
    expect(close).toHaveBeenCalledWith('client-test', 'user-test', {
      terminalRuntimeSessionId: session.terminalRuntimeSessionId,
    })
    expect(reconcileWorktree).toHaveBeenCalledWith({
      userId: 'user-test',
      repoRoot: request.repoRoot,
      scope: '/repo\0repo-runtime-test',
      worktreePath: request.worktreePath,
    })
    expect(broadcastWorkspaceTabsChanged).toHaveBeenCalledWith('user-test', request.repoRoot)
  })

  test('does not claim runtime close success or mutate tabs when provider close is unconfirmed', async () => {
    const session = terminalSession('term-111111111111111111111', 'pty_session_1_aaaaaaaaa')
    const reconcileWorktree = vi.fn()
    const application = createWorkspacePaneRuntimeApplication({
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      terminalWorktree: { listSessionsForUser: async () => [session] },
      terminal: { create: async () => terminalCreateSuccess(), close: async () => false },
      workspaceTabsCoordinator: {
        ensureRuntimeTabForSession: vi.fn(),
        reconcileWorktree,
      } as unknown as Pick<WorkspacePaneTabsCoordinator, 'ensureRuntimeTabForSession' | 'reconcileWorktree'>,
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
      terminalWorktree: { listSessionsForUser: listSessions },
      terminal: {
        create: async () => await createResult.promise,
        close: () => true,
      },
      workspaceTabsCoordinator: {
        ensureRuntimeTabForSession: async () =>
          snapshot([{ type: 'terminal', runtimeSessionId: session.terminalSessionId }]),
        reconcileWorktree: async () => snapshot([]),
      } as unknown as Pick<WorkspacePaneTabsCoordinator, 'ensureRuntimeTabForSession' | 'reconcileWorktree'>,
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
    expect(listSessions).toHaveBeenCalledTimes(2)
  })

  test('lets an earlier admitted open finish before a later removal that fails validation', async () => {
    const worktreeOperations = createPhysicalWorktreeOperationCoordinator()
    const createResult = deferred<Extract<TerminalCreateResult, { ok: true }>>()
    const close = vi.fn(async () => true)
    const application = createWorkspacePaneRuntimeApplication({
      worktreeOperations,
      terminalWorktree: { listSessionsForUser: async () => [] },
      terminal: { create: async () => await createResult.promise, close },
      workspaceTabsCoordinator: {
        ensureRuntimeTabForSession: async (input: {
          repoRoot: string
          worktreePath: string
          permit: PhysicalWorktreeOperationPermit
        }) => {
          worktreeOperations.assertPermit({ repoRoot: input.repoRoot, worktreePath: input.worktreePath }, input.permit)
          return snapshot([{ type: 'terminal', runtimeSessionId: 'term-111111111111111111111' }])
        },
        reconcileWorktree: vi.fn(),
      } as unknown as Pick<WorkspacePaneTabsCoordinator, 'ensureRuntimeTabForSession' | 'reconcileWorktree'>,
      isCurrentRepoRuntime: () => true,
      broadcastWorkspaceTabsChanged: vi.fn(),
    })

    const open = application.open('client-test', 'user-test', { runtimeType: 'terminal', request })
    await vi.waitFor(() => expect(worktreeOperations.isRemovalAdmitted(request)).toBe(false))
    const removal = worktreeOperations.runRemoval(request, async () => ({ ok: false, message: 'validation failed' }))
    expect(worktreeOperations.isRemovalAdmitted(request)).toBe(true)

    createResult.resolve(terminalCreateSuccess())
    await expect(open).resolves.toMatchObject({ ok: true })
    await expect(removal).resolves.toEqual({
      admitted: true,
      value: { ok: false, message: 'validation failed' },
    })
    expect(close).not.toHaveBeenCalled()
  })

  test('closes a newly created terminal and reconciles if projection unexpectedly throws', async () => {
    const runtime = terminalCreateSuccess()
    const close = vi.fn(async () => true)
    const reconcileWorktree = vi.fn(async () => snapshot([]))
    const broadcastWorkspaceTabsChanged = vi.fn()
    const application = createWorkspacePaneRuntimeApplication({
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      terminalWorktree: { listSessionsForUser: async () => [] },
      terminal: { create: async () => runtime, close },
      workspaceTabsCoordinator: {
        ensureRuntimeTabForSession: async () => {
          throw new Error('projection failed')
        },
        reconcileWorktree,
      } as unknown as Pick<WorkspacePaneTabsCoordinator, 'ensureRuntimeTabForSession' | 'reconcileWorktree'>,
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
    terminalRuntimeSessionId,
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
    sessions: [terminalSession(terminalSessionId, terminalRuntimeSessionId)],
  }
}

function terminalSession(terminalSessionId: string, terminalRuntimeSessionId: string) {
  return {
    terminalRuntimeSessionId,
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
