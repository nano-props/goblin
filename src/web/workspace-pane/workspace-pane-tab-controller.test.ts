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
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import {
  createRepoBranch,
  resetWorkspacesStore,
  seedRepoReadModelQueryData,
  seedRepoWithReadModelForTest,
} from '#/web/test-utils/bridge.ts'
import { beginPrimaryWindowPresentation } from '#/web/primary-window-presentation.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

const SOURCE_ROUTE = { kind: 'static' as const, tab: 'files' as const }
const TARGET_ROUTE = { kind: 'static' as const, tab: 'status' as const }
const WORKSPACE_ID = workspaceIdForTest('goblin+file:///repo')

describe('workspace pane tab controller transactions', () => {
  beforeEach(() => {
    primaryWindowQueryClient.clear()
    resetWorkspacesStore()
    seedRepoWithReadModelForTest({
      id: WORKSPACE_ID,
      workspaceRuntimeId: 'repo-runtime-1',
      branches: [createRepoBranch('feature/a', { worktree: { path: '/worktree-a' } })],
      currentBranchName: 'feature/a',
      preferredWorkspacePaneTab: 'files',
    })
  })

  test('commits an exact target route without feature observation', async () => {
    const setWorkspacePaneTab = vi.spyOn(useWorkspacesStore.getState(), 'setWorkspacePaneTab')
    await expect(
      commitWorkspacePaneExactTargetRoute(workspacePaneTarget(), SOURCE_ROUTE, TARGET_ROUTE, committingNavigation()),
    ).resolves.toBe(true)
    expect(setWorkspacePaneTab).toHaveBeenCalledWith(WORKSPACE_ID, 'feature/a', 'status')
  })

  test('passes the observed route as a compare-and-set precondition', async () => {
    const commitWorkspacePaneRoute = vi.fn(() => false)

    await expect(
      commitWorkspacePaneExactTargetRoute(workspacePaneTarget(), SOURCE_ROUTE, TARGET_ROUTE, {
        commitWorkspacePaneRoute,
      }),
    ).resolves.toBe(false)
    expect(commitWorkspacePaneRoute).toHaveBeenCalledWith(
      WORKSPACE_ID,
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
      WORKSPACE_ID,
      'feature/a',
      TARGET_ROUTE,
      expect.objectContaining({ routePrecondition: { kind: 'current-workspace-target' } }),
    )
  })

  test('presents a workspace-scoped tab through the workspace route', async () => {
    const showWorkspaceRootPaneTab = vi.fn((_repoId, presentation, options) => {
      useWorkspacesStore
        .getState()
        .setWorkspacePaneTabForTarget(
          { kind: 'workspace-root', workspaceId: WORKSPACE_ID },
          presentation.kind === 'terminal' ? 'terminal' : presentation.tab,
        )
      options?.onCommit?.()
      return true
    })
    const navigation = { commitWorkspacePaneRoute: vi.fn(() => false), showWorkspaceRootPaneTab }

    await expect(
      selectWorkspacePaneControllerTab(
        {
          ...workspacePaneTarget(),
          branchName: null,
          worktreePath: '/repo',
          paneTarget: { kind: 'workspace-root', workspaceId: WORKSPACE_ID },
        },
        staticTab('files'),
        navigation,
      ),
    ).resolves.toBe(true)

    expect(navigation.commitWorkspacePaneRoute).not.toHaveBeenCalled()
    expect(showWorkspaceRootPaneTab).toHaveBeenCalledWith(
      WORKSPACE_ID,
      { kind: 'static', tab: 'files' },
      expect.objectContaining({ presentationToken: expect.any(Object) }),
    )
    const targetKey = workspacePaneTabsTargetIdentityKey({
      kind: 'workspace-root',
      workspaceId: WORKSPACE_ID,
    })
    expect(
      useWorkspacesStore.getState().workspaces[WORKSPACE_ID]?.ui.preferredWorkspacePaneTabByTarget[targetKey],
    ).toBe('files')
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
        workspaceId: WORKSPACE_ID,
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
          workspaceId: WORKSPACE_ID,
          workspaceRuntimeId: 'repo-runtime-1',
          branchName: 'feature/renamed',
          worktreePath: '/worktree-a',
          paneTarget: {
            kind: 'git-worktree',
            workspaceId: WORKSPACE_ID,
            worktreePath: '/worktree-a',
          },
        },
        { kind: 'terminal', terminalSessionId: 'term-111111111111111111111' },
        navigation,
      ),
    ).resolves.toBe(true)

    expect(navigation.commitWorkspacePaneRoute).toHaveBeenCalledWith(
      WORKSPACE_ID,
      'feature/renamed',
      { kind: 'terminal', terminalSessionId: 'term-111111111111111111111' },
      expect.any(Object),
    )
    const targetKey = workspacePaneTabsTargetIdentityKey({
      kind: 'git-worktree' as const,
      workspaceId: WORKSPACE_ID,
      worktreePath: '/worktree-a',
    })
    expect(
      useWorkspacesStore.getState().workspaces[WORKSPACE_ID]?.ui.preferredWorkspacePaneTabByTarget[targetKey],
    ).toBe('terminal')
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
    useWorkspacesStore.setState((state) => ({
      workspaces: {
        ...state.workspaces,
        [WORKSPACE_ID]: { ...state.workspaces[WORKSPACE_ID]!, workspaceRuntimeId: 'repo-runtime-2' },
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
    const repo = useWorkspacesStore.getState().workspaces[WORKSPACE_ID]!
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
    workspaceId: WORKSPACE_ID,
    workspaceRuntimeId: 'repo-runtime-1',
    branchName: 'feature/a',
    worktreePath: '/worktree-a',
    paneTarget: { kind: 'git-worktree', workspaceId: WORKSPACE_ID, worktreePath: '/worktree-a' },
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
