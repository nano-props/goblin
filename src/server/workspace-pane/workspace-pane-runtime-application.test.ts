import { describe, expect, test, vi } from 'vitest'
import { createWorkspacePaneRuntimeApplication } from '#/server/workspace-pane/workspace-pane-runtime-application.ts'
import type { TerminalCreateResult } from '#/shared/terminal-types.ts'
import type { WorkspacePaneTabsCoordinator } from '#/server/workspace-pane/workspace-pane-tabs-coordinator.ts'
import type { WorkspacePaneTabsSnapshot } from '#/shared/workspace-pane-tabs.ts'

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
      terminal: { create, listSessions: async () => [], close: () => false },
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
      terminal: {
        create: async () => ({ ok: false, message: 'error.terminal-create-failed' }),
        listSessions: async () => [],
        close: () => false,
      },
      workspaceTabsCoordinator: { ensureRuntimeTabForSession, reconcileWorktree: vi.fn() },
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
      const stale = { ok: false as const, runtimeType: 'terminal' as const, message: 'error.repo-runtime-stale' }
      const ensureRuntimeTabForSession = vi.fn(async (input: { guardBeforeWrite?: () => typeof stale | null }) => {
        return input.guardBeforeWrite?.() ?? []
      })
      const broadcastWorkspaceTabsChanged = vi.fn()
      const application = createWorkspacePaneRuntimeApplication({
        terminal: { create: async () => runtime, listSessions: async () => [], close },
        workspaceTabsCoordinator: { ensureRuntimeTabForSession, reconcileWorktree: vi.fn() } as unknown as Pick<
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
      expect(broadcastWorkspaceTabsChanged).not.toHaveBeenCalled()
    },
  )

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
      terminal: { create: async () => runtime, listSessions: async () => [], close: () => false },
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
    const application = createWorkspacePaneRuntimeApplication({
      terminal: { create: async () => terminalCreateSuccess(), listSessions: async () => [session], close },
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
    ).resolves.toEqual({ ok: true, runtimeType: 'terminal', workspacePaneTabs })
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

  test('close-worktree enumerates server sessions and only closes the requested provider worktree', async () => {
    const targetSession = terminalSession('term-111111111111111111111', 'pty_session_1_aaaaaaaaa')
    const otherSession = {
      ...terminalSession('term-222222222222222222222', 'pty_session_2_aaaaaaaaa'),
      worktreePath: '/repo/other-worktree',
    }
    const close = vi.fn(() => true)
    const workspacePaneTabs = snapshot([{ type: 'status', tabId: 'workspace-pane:status' }])
    const application = createWorkspacePaneRuntimeApplication({
      terminal: {
        create: async () => terminalCreateSuccess(),
        listSessions: async () => [targetSession, otherSession],
        close,
      },
      workspaceTabsCoordinator: {
        ensureRuntimeTabForSession: vi.fn(),
        reconcileWorktree: async () => workspacePaneTabs,
      } as unknown as Pick<WorkspacePaneTabsCoordinator, 'ensureRuntimeTabForSession' | 'reconcileWorktree'>,
      isCurrentRepoRuntime: () => true,
      broadcastWorkspaceTabsChanged: () => {},
    })

    await expect(
      application.closeWorktree('client-test', 'user-test', {
        runtimeType: 'terminal',
        target: {
          repoRoot: request.repoRoot,
          repoRuntimeId: request.repoRuntimeId,
          branchName: request.branch,
          worktreePath: request.worktreePath,
        },
      }),
    ).resolves.toEqual({ ok: true, runtimeType: 'terminal', workspacePaneTabs })
    expect(close).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledWith('client-test', 'user-test', {
      terminalRuntimeSessionId: targetSession.terminalRuntimeSessionId,
    })
  })

  test('serializes open and close through the shared user/runtime/worktree queue', async () => {
    const createResult = deferred<Extract<TerminalCreateResult, { ok: true }>>()
    const session = terminalSession('term-111111111111111111111', 'pty_session_1_aaaaaaaaa')
    const listSessions = vi.fn(async () => [session])
    const application = createWorkspacePaneRuntimeApplication({
      terminal: {
        create: async () => await createResult.promise,
        listSessions,
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
    expect(listSessions).toHaveBeenCalledOnce()
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
