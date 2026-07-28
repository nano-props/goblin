import { describe, expect, test, vi } from 'vitest'
import {
  otherWorktreeRoot,
  paneTabsSnapshot,
  request,
  runtimeTabsCoordinator,
  terminalCreateSuccess,
  terminalSession,
  workspaceId,
} from '#/server/test-utils/workspace-pane-runtime-application.ts'
import {
  testPhysicalWorktreeExecutionCapability,
  testPhysicalWorktrees,
} from '#/server/test-utils/physical-worktree-identity.ts'
import { terminalSessionRuntimeScope } from '#/server/terminal/terminal-session-scope.ts'
import { createWorkspacePaneRuntimeApplication } from '#/server/workspace-pane/workspace-pane-runtime-application.ts'
import { createPhysicalWorktreeOperationCoordinator } from '#/server/worktree-removal/physical-worktree-operation-coordinator.ts'

describe('close reconciliation', () => {
  test('closes a terminal and returns the canonical tabs committed under the same worktree operation', async () => {
    const session = terminalSession('term-111111111111111111111', 'pty_session_1_aaaaaaaaa')
    const close = vi.fn(() => ({ kind: 'closed' as const }))
    const broadcastWorkspaceTabsChanged = vi.fn()
    const reconcileWorktreeAdmitted = vi.fn(async () => paneTabsSnapshot)
    const listSessions = vi.fn().mockResolvedValueOnce([session])
    const application = createWorkspacePaneRuntimeApplication({
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      physicalWorktrees: testPhysicalWorktrees,
      terminalSessions: { listSessionsForUser: listSessions },
      terminal: { createAdmitted: async () => terminalCreateSuccess(), close },
      workspaceTabsCoordinator: runtimeTabsCoordinator({
        ensureRuntimeTabForSession: vi.fn(),
        reconcileWorktreeAdmitted,
      }),
      isCurrentWorkspaceRuntimeMembership: () => true,
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
      paneTabsSnapshot,
    })
    expect(close).toHaveBeenCalledWith('client-test', 'user-test', {
      terminalRuntimeSessionId: session.terminalRuntimeSessionId,
    })
    expect(reconcileWorktreeAdmitted).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-test',
        workspaceId,
        scope: terminalSessionRuntimeScope(workspaceId, request.workspaceRuntimeId),
        worktreePath: request.worktreePath,
        physicalWorktreeCapability: expect.anything(),
        permit: expect.anything(),
        assertCurrent: expect.any(Function),
      }),
    )
    expect(broadcastWorkspaceTabsChanged).toHaveBeenCalledWith(
      'user-test',
      workspaceId,
      request.workspaceRuntimeId,
      paneTabsSnapshot.revision,
    )
  })

  test('reconciles stale pane ownership when the durable terminal is already closed', async () => {
    const close = vi.fn()
    const reconcileWorktreeAdmitted = vi.fn(async () => paneTabsSnapshot)
    const application = createWorkspacePaneRuntimeApplication({
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      physicalWorktrees: testPhysicalWorktrees,
      terminalSessions: { listSessionsForUser: async () => [] },
      terminal: { createAdmitted: async () => terminalCreateSuccess(), close },
      workspaceTabsCoordinator: runtimeTabsCoordinator({
        ensureRuntimeTabForSession: vi.fn(),
        reconcileWorktreeAdmitted,
      }),
      isCurrentWorkspaceRuntimeMembership: () => true,
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
      },
      paneTabsSnapshot,
    })
    expect(close).not.toHaveBeenCalled()
    expect(reconcileWorktreeAdmitted).toHaveBeenCalledOnce()
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
    const close = vi.fn(() => ({ kind: 'closed' as const }))
    const application = createWorkspacePaneRuntimeApplication({
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      physicalWorktrees: {
        capture: async () => testPhysicalWorktreeExecutionCapability('/repo'),
      },
      terminalSessions: { listSessionsForUser: async () => [session] },
      terminal: { createAdmitted: async () => terminalCreateSuccess(), close },
      workspaceTabsCoordinator: runtimeTabsCoordinator({ ensureRuntimeTabForSession: vi.fn() }),
      isCurrentWorkspaceRuntimeMembership: () => true,
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
    const close = vi.fn(() => ({ kind: 'closed' as const }))
    const application = createWorkspacePaneRuntimeApplication({
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      physicalWorktrees: {
        capture: async () => testPhysicalWorktreeExecutionCapability(request.worktreePath),
      },
      terminalSessions: { listSessionsForUser: async () => [session] },
      terminal: { createAdmitted: async () => terminalCreateSuccess(), close },
      workspaceTabsCoordinator: runtimeTabsCoordinator({ ensureRuntimeTabForSession: vi.fn() }),
      isCurrentWorkspaceRuntimeMembership: () => true,
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
      terminalSessions: { listSessionsForUser: async () => [session] },
      terminal: {
        createAdmitted: async () => terminalCreateSuccess(),
        close: async () => ({ kind: 'failed' as const }),
      },
      workspaceTabsCoordinator: runtimeTabsCoordinator({ ensureRuntimeTabForSession: vi.fn() }),
      isCurrentWorkspaceRuntimeMembership: () => true,
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

  test('treats capability cleanup during close as an idempotent already-closed outcome', async () => {
    const session = terminalSession('term-111111111111111111111', 'pty_session_1_aaaaaaaaa')
    const application = createWorkspacePaneRuntimeApplication({
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      physicalWorktrees: testPhysicalWorktrees,
      terminalSessions: { listSessionsForUser: async () => [session] },
      terminal: {
        createAdmitted: async () => terminalCreateSuccess(),
        close: async () => ({ kind: 'already-closed' as const }),
      },
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
        sessionId: session.terminalSessionId,
        target: { target: request.target },
      }),
    ).resolves.toEqual({
      ok: true,
      runtimeType: 'terminal',
      runtime: {
        action: 'already-closed',
        terminalSessionId: session.terminalSessionId,
      },
      paneTabsSnapshot,
    })
  })
})
