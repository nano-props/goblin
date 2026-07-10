import { describe, expect, test, vi } from 'vitest'
import { createWorkspacePaneRuntimeApplication } from '#/server/workspace-pane/workspace-pane-runtime-application.ts'
import type { TerminalCreateResult } from '#/shared/terminal-types.ts'
import type { WorkspacePaneTabsCoordinator } from '#/server/workspace-pane/workspace-pane-tabs-coordinator.ts'

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
    const ensureRuntimeTabForSession = vi.fn(async () => [
      { type: 'status' as const, tabId: 'workspace-pane:status' as const },
      { type: 'terminal' as const, runtimeSessionId: runtime.terminalSessionId },
    ])
    const broadcastWorkspaceTabsChanged = vi.fn()
    const application = createWorkspacePaneRuntimeApplication({
      terminal: { create },
      workspaceTabsCoordinator: { ensureRuntimeTabForSession } as unknown as Pick<
        WorkspacePaneTabsCoordinator,
        'ensureRuntimeTabForSession'
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
      tabs: [
        { type: 'status', tabId: 'workspace-pane:status' },
        { type: 'terminal', runtimeSessionId: runtime.terminalSessionId },
      ],
    })
    expect(broadcastWorkspaceTabsChanged).toHaveBeenCalledWith('user-test', '/repo')
  })

  test('does not touch tabs when the provider create fails', async () => {
    const ensureRuntimeTabForSession = vi.fn()
    const broadcastWorkspaceTabsChanged = vi.fn()
    const application = createWorkspacePaneRuntimeApplication({
      terminal: { create: async () => ({ ok: false, message: 'error.terminal-create-failed' }) },
      workspaceTabsCoordinator: { ensureRuntimeTabForSession },
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

  test('rechecks repo runtime authority at the tab commit boundary', async () => {
    const stale = { ok: false as const, runtimeType: 'terminal' as const, message: 'error.repo-runtime-stale' }
    const ensureRuntimeTabForSession = vi.fn(async (input: { guardBeforeWrite?: () => typeof stale | null }) => {
      return input.guardBeforeWrite?.() ?? []
    })
    const broadcastWorkspaceTabsChanged = vi.fn()
    const application = createWorkspacePaneRuntimeApplication({
      terminal: { create: async () => terminalCreateSuccess() },
      workspaceTabsCoordinator: { ensureRuntimeTabForSession } as unknown as Pick<
        WorkspacePaneTabsCoordinator,
        'ensureRuntimeTabForSession'
      >,
      isCurrentRepoRuntime: () => false,
      broadcastWorkspaceTabsChanged,
    })

    await expect(application.open('client-test', 'user-test', { runtimeType: 'terminal', request })).resolves.toEqual(
      stale,
    )
    expect(broadcastWorkspaceTabsChanged).not.toHaveBeenCalled()
  })
})

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
    sessions: [
      {
        terminalRuntimeSessionId,
        terminalSessionId,
        repoRuntimeId: request.repoRuntimeId,
        repoRoot: request.repoRoot,
        branch: request.branch,
        worktreePath: request.worktreePath,
        cwd: request.worktreePath,
        controller: { clientId: 'client-test', status: 'connected' },
        processName: 'zsh',
        canonicalTitle: null,
        phase: 'open',
        message: null,
        cols: 100,
        rows: 30,
      },
    ],
  }
}
