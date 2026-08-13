import { afterEach, describe, expect, test, vi } from 'vitest'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import type { AppNavigationActions } from '#/web/app-navigation-actions.ts'
import { appQueryClient } from '#/web/app-query-client.ts'
import { appNavigationActionsForTest } from '#/web/test-utils/app-navigation.ts'
import {
  createRepoBranch,
  createRepoWorktreeSnapshotForTest,
  resetWorkspacesStore,
  seedRepoShellForTest,
  seedRepoWithReadModelForTest,
} from '#/web/test-utils/repo-store.ts'
import { beginAppNavigation, resetAppNavigationForTest } from '#/web/app-navigation-lifecycle.ts'
import { commitWorkspacePaneTerminalDestination } from '#/web/workspace-pane/workspace-pane-terminal-destination-navigation.ts'
import { workspacePaneTabsQueryKey } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import {
  resetWorkspacePaneActionQueueForTest,
  runWorkspacePaneAction,
} from '#/web/workspace-pane/workspace-pane-action-queue.ts'

const WORKSPACE_ID = workspaceIdForTest('goblin+file:///workspace')
const WORKSPACE_RUNTIME_ID = 'workspace-runtime-terminal-destination'
const TERMINAL_SESSION_ID = 'term-destination-session'

afterEach(() => {
  resetWorkspacePaneActionQueueForTest()
  resetAppNavigationForTest()
  resetWorkspacesStore()
  appQueryClient.clear()
})

describe('workspace pane terminal destination navigation', () => {
  test('uses the stable worktree route family for a current branch worktree terminal', async () => {
    seedRepoWithReadModelForTest({
      worktrees: [createRepoWorktreeSnapshotForTest('feature/navigation', '/workspace/feature')],
      id: WORKSPACE_ID,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branches: [createRepoBranch('feature/navigation')],
      currentBranchName: 'feature/navigation',
    })
    const commitWorkspacePaneRoute = committedBranchRoute()
    const commitFilesystemWorkspacePaneRoute = vi.fn<AppNavigationActions['commitFilesystemWorkspacePaneRoute']>(
      async () => true,
    )
    seedTerminalPaneTab('/workspace/feature')

    await expect(
      commitWorkspacePaneTerminalDestination({
        base: gitTerminalBase('/workspace/feature', WORKSPACE_RUNTIME_ID),
        terminalSessionId: TERMINAL_SESSION_ID,
        navigation: navigationWith({ commitWorkspacePaneRoute, commitFilesystemWorkspacePaneRoute }),
      }),
    ).resolves.toEqual({ kind: 'completed', changed: true, presentation: 'router-settled' })

    expect(commitFilesystemWorkspacePaneRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        routeTarget: {
          kind: 'git-worktree',
          workspaceId: WORKSPACE_ID,
          worktreePath: '/workspace/feature',
        },
      }),
      { kind: 'terminal', terminalSessionId: TERMINAL_SESSION_ID },
      expect.objectContaining({ navigationGeneration: expect.any(Number) }),
    )
    expect(commitWorkspacePaneRoute).not.toHaveBeenCalled()
  })

  test('rejects a branch terminal from an old runtime or moved worktree', async () => {
    seedRepoWithReadModelForTest({
      worktrees: [createRepoWorktreeSnapshotForTest('feature/navigation', '/workspace/current')],
      id: WORKSPACE_ID,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branches: [createRepoBranch('feature/navigation')],
      currentBranchName: 'feature/navigation',
    })
    const commitWorkspacePaneRoute = committedBranchRoute()
    const navigation = navigationWith({ commitWorkspacePaneRoute })
    seedTerminalPaneTab('/workspace/current')

    await expect(
      commitWorkspacePaneTerminalDestination({
        base: gitTerminalBase('/workspace/current', 'workspace-runtime-replaced'),
        terminalSessionId: TERMINAL_SESSION_ID,
        navigation,
      }),
    ).resolves.toEqual({ kind: 'blocked' })
    await expect(
      commitWorkspacePaneTerminalDestination({
        base: gitTerminalBase('/workspace/previous', WORKSPACE_RUNTIME_ID),
        terminalSessionId: TERMINAL_SESSION_ID,
        navigation,
      }),
    ).resolves.toEqual({ kind: 'target-missing' })

    expect(commitWorkspacePaneRoute).not.toHaveBeenCalled()
  })

  test('reports a rejected worktree route without falling back to a branch route', async () => {
    seedRepoWithReadModelForTest({
      worktrees: [createRepoWorktreeSnapshotForTest('feature/navigation', '/workspace/feature')],
      id: WORKSPACE_ID,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branches: [createRepoBranch('feature/navigation')],
      currentBranchName: 'feature/navigation',
    })
    const commitWorkspacePaneRoute = vi.fn<AppNavigationActions['commitWorkspacePaneRoute']>(async () => false)
    const commitFilesystemWorkspacePaneRoute = vi.fn<AppNavigationActions['commitFilesystemWorkspacePaneRoute']>()
    seedTerminalPaneTab('/workspace/feature')

    await expect(
      commitWorkspacePaneTerminalDestination({
        base: gitTerminalBase('/workspace/feature', WORKSPACE_RUNTIME_ID),
        terminalSessionId: TERMINAL_SESSION_ID,
        navigation: navigationWith({ commitWorkspacePaneRoute, commitFilesystemWorkspacePaneRoute }),
      }),
    ).resolves.toEqual({ kind: 'navigation-rejected' })

    expect(commitFilesystemWorkspacePaneRoute).toHaveBeenCalledOnce()
    expect(commitWorkspacePaneRoute).not.toHaveBeenCalled()
  })

  test('keeps detached worktree and non-Git root terminals in their filesystem route families', async () => {
    seedRepoWithReadModelForTest({ id: WORKSPACE_ID, workspaceRuntimeId: WORKSPACE_RUNTIME_ID })
    const commitFilesystemWorkspacePaneRoute = vi.fn<AppNavigationActions['commitFilesystemWorkspacePaneRoute']>(
      async () => true,
    )
    const navigation = navigationWith({ commitFilesystemWorkspacePaneRoute })
    seedTerminalPaneTab('/workspace/detached')

    await expect(
      commitWorkspacePaneTerminalDestination({
        base: gitTerminalBase('/workspace/detached', WORKSPACE_RUNTIME_ID),
        terminalSessionId: TERMINAL_SESSION_ID,
        navigation,
      }),
    ).resolves.toEqual({ kind: 'completed', changed: true, presentation: 'router-settled' })
    expect(commitFilesystemWorkspacePaneRoute).toHaveBeenLastCalledWith(
      {
        routeTarget: { kind: 'git-worktree', workspaceId: WORKSPACE_ID, worktreePath: '/workspace/detached' },
        workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      },
      { kind: 'terminal', terminalSessionId: TERMINAL_SESSION_ID },
      { navigationGeneration: expect.any(Number) },
    )

    seedRepoShellForTest({ id: WORKSPACE_ID, workspaceRuntimeId: WORKSPACE_RUNTIME_ID })
    seedTerminalPaneTab(null)
    await expect(
      commitWorkspacePaneTerminalDestination({
        base: {
          target: { kind: 'workspace-root', workspaceId: WORKSPACE_ID, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
          presentation: { kind: 'workspace-root' },
        },
        terminalSessionId: TERMINAL_SESSION_ID,
        navigation,
      }),
    ).resolves.toEqual({ kind: 'completed', changed: true, presentation: 'router-settled' })
    expect(commitFilesystemWorkspacePaneRoute).toHaveBeenLastCalledWith(
      {
        routeTarget: { kind: 'workspace-root', workspaceId: WORKSPACE_ID },
        workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      },
      { kind: 'terminal', terminalSessionId: TERMINAL_SESSION_ID },
      { navigationGeneration: expect.any(Number) },
    )
  })

  test('distinguishes a superseded filesystem destination from a rejected navigation', async () => {
    seedRepoShellForTest({ id: WORKSPACE_ID, workspaceRuntimeId: WORKSPACE_RUNTIME_ID })
    const commitFilesystemWorkspacePaneRoute = vi.fn<AppNavigationActions['commitFilesystemWorkspacePaneRoute']>(
      async () => {
        beginAppNavigation()
        return false
      },
    )
    seedTerminalPaneTab(null)

    await expect(
      commitWorkspacePaneTerminalDestination({
        base: {
          target: { kind: 'workspace-root', workspaceId: WORKSPACE_ID, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
          presentation: { kind: 'workspace-root' },
        },
        terminalSessionId: TERMINAL_SESSION_ID,
        navigation: navigationWith({ commitFilesystemWorkspacePaneRoute }),
      }),
    ).resolves.toEqual({ kind: 'superseded' })
  })

  test('fails fast when the ready canonical pane projection does not contain the terminal', async () => {
    seedRepoShellForTest({ id: WORKSPACE_ID, workspaceRuntimeId: WORKSPACE_RUNTIME_ID })
    appQueryClient.setQueryData(workspacePaneTabsQueryKey(WORKSPACE_ID, WORKSPACE_RUNTIME_ID), {
      revision: 3,
      entries: [],
    })
    const commitFilesystemWorkspacePaneRoute = vi.fn<AppNavigationActions['commitFilesystemWorkspacePaneRoute']>()

    await expect(
      commitWorkspacePaneTerminalDestination({
        base: {
          target: { kind: 'workspace-root', workspaceId: WORKSPACE_ID, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
          presentation: { kind: 'workspace-root' },
        },
        terminalSessionId: TERMINAL_SESSION_ID,
        navigation: navigationWith({ commitFilesystemWorkspacePaneRoute }),
      }),
    ).resolves.toEqual({ kind: 'target-missing' })
    expect(commitFilesystemWorkspacePaneRoute).not.toHaveBeenCalled()
  })

  test('blocks navigation while canonical pane authority is unavailable', async () => {
    seedRepoShellForTest({ id: WORKSPACE_ID, workspaceRuntimeId: WORKSPACE_RUNTIME_ID })
    const commitFilesystemWorkspacePaneRoute = vi.fn<AppNavigationActions['commitFilesystemWorkspacePaneRoute']>()

    await expect(
      commitWorkspacePaneTerminalDestination({
        base: {
          target: { kind: 'workspace-root', workspaceId: WORKSPACE_ID, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
          presentation: { kind: 'workspace-root' },
        },
        terminalSessionId: TERMINAL_SESSION_ID,
        navigation: navigationWith({ commitFilesystemWorkspacePaneRoute }),
      }),
    ).resolves.toEqual({ kind: 'blocked' })
    expect(commitFilesystemWorkspacePaneRoute).not.toHaveBeenCalled()
  })

  test('fails fast instead of waiting behind an action on the same target', async () => {
    seedRepoWithReadModelForTest({
      id: WORKSPACE_ID,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branches: [createRepoBranch('feature/navigation')],
      currentBranchName: 'feature/navigation',
    })
    seedTerminalPaneTab('/workspace/feature')
    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const occupied = runWorkspacePaneAction(
      {
        kind: 'git-worktree',
        workspaceId: WORKSPACE_ID,
        workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
        worktreePath: '/workspace/feature',
      },
      async () => {
        started.resolve()
        await release.promise
      },
    )
    await started.promise
    const commitWorkspacePaneRoute = committedBranchRoute()
    await expect(
      commitWorkspacePaneTerminalDestination({
        base: gitTerminalBase('/workspace/feature', WORKSPACE_RUNTIME_ID),
        terminalSessionId: TERMINAL_SESSION_ID,
        navigation: navigationWith({ commitWorkspacePaneRoute }),
      }),
    ).resolves.toEqual({ kind: 'blocked' })
    expect(commitWorkspacePaneRoute).not.toHaveBeenCalled()

    release.resolve()
    await occupied
  })
})

function seedTerminalPaneTab(worktreePath: string | null): void {
  appQueryClient.setQueryData(workspacePaneTabsQueryKey(WORKSPACE_ID, WORKSPACE_RUNTIME_ID), {
    revision: 2,
    entries: [
      {
        target: worktreePath
          ? {
              kind: 'git-worktree' as const,
              workspaceId: WORKSPACE_ID,
              workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
              root: workspaceIdForTest(`goblin+file://${worktreePath}`),
            }
          : {
              kind: 'workspace-root' as const,
              workspaceId: WORKSPACE_ID,
              workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
            },
        tabs: [{ type: 'terminal' as const, runtimeSessionId: TERMINAL_SESSION_ID }],
      },
    ],
  })
}

function gitTerminalBase(worktreePath: string, workspaceRuntimeId: string): TerminalSessionBase {
  return {
    target: {
      kind: 'git-worktree',
      workspaceId: WORKSPACE_ID,
      workspaceRuntimeId,
      root: workspaceIdForTest(`goblin+file://${worktreePath}`),
    },
    presentation: { kind: 'git-worktree' },
  }
}

function committedBranchRoute(): AppNavigationActions['commitWorkspacePaneRoute'] {
  return vi.fn(async (_workspaceId, _branchName, _route, options) => {
    options?.onCommit?.()
    return true
  })
}

function navigationWith(overrides: Partial<AppNavigationActions>): AppNavigationActions {
  return appNavigationActionsForTest(overrides)
}
