import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  beginWorkspacePaneCloseActiveTabPresentationLease,
  commitWorkspacePaneCommittedRuntimeTargetRoute,
  commitWorkspacePaneControllerCloseBackTarget,
  commitWorkspacePaneExactTargetRoute,
  selectWorkspacePaneControllerTab,
  selectWorkspacePaneControllerTabEntry,
  type WorkspacePaneTabControllerCommitNavigation,
} from '#/web/workspace-pane/workspace-pane-tab-controller.ts'
import {
  workspacePaneRuntimeTabEntry,
  workspacePaneStaticTabId,
  type WorkspacePaneStaticTabType,
} from '#/shared/workspace-pane.ts'
import { workspacePaneTabsTargetIdentityKey } from '#/shared/workspace-pane-tabs-target.ts'
import type { RepoWorkspaceStaticTab, RepoWorkspaceTabModel } from '#/web/workspace-pane/repo-workspace-tab-model.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import {
  createRepoBranch,
  resetReposStore,
  seedRepoReadModelQueryData,
  seedRepoWithReadModelForTest,
} from '#/web/test-utils/bridge.ts'
import { beginPrimaryWindowPresentation } from '#/web/primary-window-presentation.ts'

const SOURCE_ROUTE = { kind: 'static' as const, tab: 'files' as const }
const TARGET_ROUTE = { kind: 'static' as const, tab: 'status' as const }

describe('workspace pane tab controller transactions', () => {
  beforeEach(() => {
    primaryWindowQueryClient.clear()
    resetReposStore()
    seedRepoWithReadModelForTest({
      id: 'goblin+file:///repo',
      repoRuntimeId: 'repo-runtime-1',
      branches: [createRepoBranch('feature/a', { worktree: { path: '/worktree-a' } })],
      currentBranchName: 'feature/a',
      preferredWorkspacePaneTab: 'files',
    })
  })

  test('commits an exact target route without feature observation', async () => {
    const setWorkspacePaneTab = vi.spyOn(useReposStore.getState(), 'setWorkspacePaneTab')
    await expect(
      commitWorkspacePaneExactTargetRoute(workspacePaneTarget(), SOURCE_ROUTE, TARGET_ROUTE, committingNavigation()),
    ).resolves.toBe(true)
    expect(setWorkspacePaneTab).toHaveBeenCalledWith('goblin+file:///repo', 'feature/a', 'status')
  })

  test('passes the observed route as a compare-and-set precondition', async () => {
    const commitWorkspacePaneRoute = vi.fn(() => false)

    await expect(
      commitWorkspacePaneExactTargetRoute(workspacePaneTarget(), SOURCE_ROUTE, TARGET_ROUTE, {
        commitWorkspacePaneRoute,
      }),
    ).resolves.toBe(false)
    expect(commitWorkspacePaneRoute).toHaveBeenCalledWith(
      'goblin+file:///repo',
      'feature/a',
      TARGET_ROUTE,
      expect.objectContaining({ routePrecondition: { kind: 'exact-route', route: SOURCE_ROUTE } }),
    )
  })

  test('rebases an absolute selection to the current workspace target at execution time', async () => {
    const commitWorkspacePaneRoute = vi.fn((_repoId, _branchName, _route, options) => {
      options?.onCommit?.()
      return true
    })

    await expect(
      selectWorkspacePaneControllerTab(workspacePaneTarget(), staticTab('status'), {
        commitWorkspacePaneRoute,
      }),
    ).resolves.toBe(true)
    expect(commitWorkspacePaneRoute).toHaveBeenCalledWith(
      'goblin+file:///repo',
      'feature/a',
      TARGET_ROUTE,
      expect.objectContaining({ routePrecondition: { kind: 'current-workspace-target' } }),
    )
  })

  test('presents a workspace-scoped tab through the workspace route', async () => {
    const showRepoWorkspacePaneTab = vi.fn((_repoId, presentation, options) => {
      useReposStore
        .getState()
        .setWorkspacePaneTabForTarget(
          { kind: 'workspace-root', repoRoot: 'goblin+file:///repo' },
          presentation.kind === 'terminal' ? 'terminal' : presentation.tab,
        )
      options?.onCommit?.()
      return true
    })
    const navigation = { commitWorkspacePaneRoute: vi.fn(() => false), showRepoWorkspacePaneTab }

    await expect(
      selectWorkspacePaneControllerTab(
        {
          ...workspacePaneTarget(),
          branchName: null,
          worktreePath: '/repo',
          paneTarget: { kind: 'workspace-root', repoRoot: 'goblin+file:///repo' },
        },
        staticTab('files'),
        navigation,
      ),
    ).resolves.toBe(true)

    expect(navigation.commitWorkspacePaneRoute).not.toHaveBeenCalled()
    expect(showRepoWorkspacePaneTab).toHaveBeenCalledWith(
      'goblin+file:///repo',
      { kind: 'static', tab: 'files' },
      expect.objectContaining({ presentationToken: expect.any(Object) }),
    )
    const targetKey = workspacePaneTabsTargetIdentityKey({
      kind: 'workspace-root',
      repoRoot: 'goblin+file:///repo',
    })
    expect(useReposStore.getState().repos['goblin+file:///repo']?.ui.preferredWorkspacePaneTabByTarget[targetKey]).toBe(
      'files',
    )
  })

  test('does not create a replacement worktree presentation after the queued token is superseded', async () => {
    const tokenA = beginPrimaryWindowPresentation()
    beginPrimaryWindowPresentation()
    const showRepoWorktreeTerminalSession = vi.fn(() => true)
    const target = {
      ...workspacePaneTarget(),
      branchName: null,
      paneTarget: {
        kind: 'git-worktree' as const,
        repoRoot: 'goblin+file:///repo',
        worktreePath: '/worktree-a',
      },
      tabEntries: [workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111')],
      tabs: [],
    }

    await expect(
      selectWorkspacePaneControllerTabEntry(
        target,
        workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'),
        { commitWorkspacePaneRoute: vi.fn(() => false), showRepoWorktreeTerminalSession },
        tokenA,
      ),
    ).resolves.toBe(false)
    expect(showRepoWorktreeTerminalSession).not.toHaveBeenCalled()
  })

  test('commits a server-created runtime route while the local branch label is stale', async () => {
    const navigation = committingNavigation()

    await expect(
      commitWorkspacePaneCommittedRuntimeTargetRoute(
        {
          repoId: 'goblin+file:///repo',
          repoRuntimeId: 'repo-runtime-1',
          branchName: 'feature/renamed',
          worktreePath: '/worktree-a',
          paneTarget: {
            kind: 'git-worktree',
            repoRoot: 'goblin+file:///repo',
            worktreePath: '/worktree-a',
          },
        },
        { kind: 'terminal', terminalSessionId: 'term-111111111111111111111' },
        navigation,
      ),
    ).resolves.toBe(true)

    expect(navigation.commitWorkspacePaneRoute).toHaveBeenCalledWith(
      'goblin+file:///repo',
      'feature/renamed',
      { kind: 'terminal', terminalSessionId: 'term-111111111111111111111' },
      expect.any(Object),
    )
    const targetKey = workspacePaneTabsTargetIdentityKey({
      kind: 'git-worktree' as const,
      repoRoot: 'goblin+file:///repo',
      worktreePath: '/worktree-a',
    })
    expect(useReposStore.getState().repos['goblin+file:///repo']?.ui.preferredWorkspacePaneTabByTarget[targetKey]).toBe(
      'terminal',
    )
  })

  test('rejects exact target completion after its runtime is replaced', async () => {
    const commit = Promise.withResolvers<boolean>()
    const navigation: WorkspacePaneTabControllerCommitNavigation = {
      commitWorkspacePaneRoute: vi.fn((_repoId, _branchName, _route, options) => {
        options?.onCommit?.()
        return commit.promise
      }),
    }
    const completion = commitWorkspacePaneExactTargetRoute(
      workspacePaneTarget(),
      SOURCE_ROUTE,
      TARGET_ROUTE,
      navigation,
    )
    useReposStore.setState((state) => ({
      repos: {
        ...state.repos,
        'goblin+file:///repo': { ...state.repos['goblin+file:///repo']!, repoRuntimeId: 'repo-runtime-2' },
      },
    }))
    commit.resolve(true)
    await expect(completion).resolves.toBe(false)
  })

  test('normalizes a navigation rejection to false', async () => {
    await expect(
      commitWorkspacePaneExactTargetRoute(workspacePaneTarget(), SOURCE_ROUTE, TARGET_ROUTE, {
        commitWorkspacePaneRoute: vi.fn(async () => {
          throw new Error('router failed')
        }),
      }),
    ).resolves.toBe(false)
  })

  test('rejects completion when the target worktree changes while navigation settles', async () => {
    const commit = Promise.withResolvers<boolean>()
    const navigation: WorkspacePaneTabControllerCommitNavigation = {
      commitWorkspacePaneRoute: vi.fn((_repoId, _branchName, _route, options) => {
        options?.onCommit?.()
        return commit.promise
      }),
    }
    const completion = commitWorkspacePaneExactTargetRoute(
      workspacePaneTarget(),
      SOURCE_ROUTE,
      TARGET_ROUTE,
      navigation,
    )
    const repo = useReposStore.getState().repos['goblin+file:///repo']!
    seedRepoReadModelQueryData(repo, {
      branches: [createRepoBranch('feature/a', { worktree: { path: '/worktree-b' } })],
      currentBranch: 'feature/a',
      status: [],
    })
    commit.resolve(true)

    await expect(completion).resolves.toBe(false)
  })

  test('commits a close-back lease through exact route completion', async () => {
    const lease = beginWorkspacePaneCloseActiveTabPresentationLease({
      target: workspacePaneTarget(),
      closingTab: staticTab('files'),
      nextTab: staticTab('status'),
      workspacePaneRoute: SOURCE_ROUTE,
    })
    if (!lease) throw new Error('missing presentation lease')
    await expect(commitWorkspacePaneControllerCloseBackTarget(lease, committingNavigation())).resolves.toBe(true)
  })
})

function workspacePaneTarget(): RepoWorkspaceTabModel {
  return {
    repoId: 'goblin+file:///repo',
    repoRuntimeId: 'repo-runtime-1',
    branchName: 'feature/a',
    worktreePath: '/worktree-a',
    paneTarget: { kind: 'git-worktree', repoRoot: 'goblin+file:///repo', worktreePath: '/worktree-a' },
  } as RepoWorkspaceTabModel
}

function committingNavigation(): WorkspacePaneTabControllerCommitNavigation {
  return {
    commitWorkspacePaneRoute: vi.fn((_repoId, _branchName, _route, options) => {
      options?.onCommit?.()
      return true
    }),
  }
}

function staticTab(type: WorkspacePaneStaticTabType): RepoWorkspaceStaticTab {
  return { identity: workspacePaneStaticTabId(type), type, kind: 'static', view: null }
}
