import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { openWorkspacePaneTab } from '#/web/components/repo-workspace/open-workspace-pane-tab.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import {
  createRepoBranch,
  installWorkspacePaneTabsTestBridge,
  resetReposStore,
  seedRepoWithReadModelForTest,
} from '#/web/test-utils/bridge.ts'
import { setClientBridgeForTests } from '#/web/client-bridge.ts'
import type { PrimaryWindowNavigationActions } from '#/web/primary-window-navigation.tsx'
import { type WorkspacePaneStaticTabType, workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import { tabOpenerScopeKey } from '#/web/stores/repos/tab-opener.ts'
import {
  preferredWorkspacePaneTabForTarget,
  workspacePaneTabsTargetForRepoBranch,
} from '#/web/stores/repos/workspace-pane-preferences.ts'
import { readWorkspacePaneTabsForTarget } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { workspacePaneStaticTabsFromEntries } from '#/web/workspace-pane/workspace-pane-tabs.ts'
import { readRepoBranchQueryProjection } from '#/web/repo-branch-read-model.ts'
import { clearWorkspacePaneTabsOperationQueuesForTests } from '#/web/workspace-pane/workspace-pane-tabs-operation-queue.ts'

const REPO_ID = '/tmp/workspace-pane-tab-repo'
const WORKTREE_PATH = '/tmp/workspace-pane-tab-worktree'
const originalRefreshRuntimeProjection = useReposStore.getState().refreshRuntimeProjection

beforeEach(() => {
  resetReposStore()
  installWorkspacePaneTabsTestBridge()
  clearWorkspacePaneTabsOperationQueuesForTests()
})

afterEach(() => {
  resetReposStore()
  useReposStore.setState({ refreshRuntimeProjection: originalRefreshRuntimeProjection })
  setClientBridgeForTests(null)
  clearWorkspacePaneTabsOperationQueuesForTests()
})

describe('openWorkspacePaneTab', () => {
  test('opens status as a target-owned tab when the branch has a worktree', async () => {
    seedWorktreeRepo('status')
    const refreshRuntimeProjection = vi.fn(async () => {})
    useReposStore.setState({
      refreshRuntimeProjection: refreshRuntimeProjection as typeof originalRefreshRuntimeProjection,
    })
    const repoInstanceId = useReposStore.getState().repos[REPO_ID]!.instanceId

    await expect(
      openWorkspacePaneTab({
        repoId: REPO_ID,
        branchName: 'feature/worktree',
        worktreePath: WORKTREE_PATH,
        type: 'status',
        navigation: navigationWithStoreActions(),
      }),
    ).resolves.toBe(true)

    expect(openTabsFor('feature/worktree')).toEqual(['status'])
    expect(preferredWorkspacePaneTab()).toBe('status')
    expect(refreshRuntimeProjection).toHaveBeenCalledWith(REPO_ID, { repoInstanceId, scope: 'visible-status' })
  })

  test('registers changes as a workspace pane static tab and refreshes status', async () => {
    seedWorktreeRepo('changes')
    const refreshRuntimeProjection = vi.fn(async () => {})
    useReposStore.setState({
      refreshRuntimeProjection: refreshRuntimeProjection as typeof originalRefreshRuntimeProjection,
    })
    const repoInstanceId = useReposStore.getState().repos[REPO_ID]!.instanceId

    await expect(
      openWorkspacePaneTab({
        repoId: REPO_ID,
        branchName: 'feature/worktree',
        worktreePath: WORKTREE_PATH,
        type: 'changes',
        navigation: navigationWithStoreActions(),
      }),
    ).resolves.toBe(true)

    expect(openTabsFor('feature/worktree')).toEqual(['status', 'changes'])
    expect(preferredWorkspacePaneTab()).toBe('changes')
    expect(refreshRuntimeProjection).toHaveBeenCalledWith(REPO_ID, { repoInstanceId, scope: 'visible-status' })
  })

  test('can insert a newly opened static tab immediately after a specific tab', async () => {
    seedWorktreeRepo('history')
    installWorkspacePaneTabsTestBridge({
      updateWorkspaceTabs: async (input) => {
        expect(input.operation).toEqual({
          type: 'open-static',
          tabType: 'changes',
          insertAfterIdentity: 'workspace-pane:status',
        })
        return [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('changes')]
      },
    })

    await expect(
      openWorkspacePaneTab({
        repoId: REPO_ID,
        branchName: 'feature/worktree',
        worktreePath: WORKTREE_PATH,
        type: 'changes',
        insertAfterIdentity: 'workspace-pane:status',
        navigation: navigationWithStoreActions(),
      }),
    ).resolves.toBe(true)

    expect(openTabsFor('feature/worktree')).toEqual(['status', 'changes'])
    expect(preferredWorkspacePaneTab()).toBe('changes')
  })

  test('can explicitly append a newly opened static tab while still recording the opener', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'files',
      workspacePaneTabsByBranch: {
        'feature/worktree': [
          workspacePaneStaticTabEntry('status'),
          workspacePaneStaticTabEntry('files'),
          workspacePaneStaticTabEntry('history'),
        ],
      },
    })

    await expect(
      openWorkspacePaneTab({
        repoId: REPO_ID,
        branchName: 'feature/worktree',
        worktreePath: WORKTREE_PATH,
        type: 'changes',
        insertAfterIdentity: null,
        navigation: navigationWithStoreActions(),
      }),
    ).resolves.toBe(true)

    expect(openTabsFor('feature/worktree')).toEqual(['status', 'files', 'history', 'changes'])
    expect(
      useReposStore.getState().tabOpenerIdentityByScope[tabOpenerScopeKey(REPO_ID, 'feature/worktree')]?.[
        'workspace-pane:changes'
      ],
    ).toBe('workspace-pane:files')
  })

  test('does not select changes when the selected branch has no worktree', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/no-worktree')],
      currentBranchName: 'feature/no-worktree',
      preferredWorkspacePaneTab: 'status',
    })
    const refreshRuntimeProjection = vi.fn(async () => {})
    useReposStore.setState({
      refreshRuntimeProjection: refreshRuntimeProjection as typeof originalRefreshRuntimeProjection,
    })

    await expect(
      openWorkspacePaneTab({
        repoId: REPO_ID,
        branchName: 'feature/no-worktree',
        worktreePath: null,
        type: 'changes',
        navigation: navigationWithStoreActions(),
      }),
    ).resolves.toBe(false)

    expect(preferredWorkspacePaneTab()).toBe('status')
    expect(openTabsFor('feature/no-worktree')).toEqual(['status'])
    expect(refreshRuntimeProjection).not.toHaveBeenCalled()
  })

  test('opens status for a branch without a worktree', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/no-worktree')],
      currentBranchName: 'feature/no-worktree',
      preferredWorkspacePaneTab: 'changes',
    })

    await expect(
      openWorkspacePaneTab({
        repoId: REPO_ID,
        branchName: 'feature/no-worktree',
        worktreePath: null,
        type: 'status',
        navigation: navigationWithStoreActions(),
      }),
    ).resolves.toBe(true)

    expect(preferredWorkspacePaneTab()).toBe('status')
  })

  test('opens history as a branch-static workspace pane tab', async () => {
    seedWorktreeRepo('history')
    const refreshRuntimeProjection = vi.fn(async () => {})
    useReposStore.setState({
      refreshRuntimeProjection: refreshRuntimeProjection as typeof originalRefreshRuntimeProjection,
    })

    await expect(
      openWorkspacePaneTab({
        repoId: REPO_ID,
        branchName: 'feature/worktree',
        worktreePath: WORKTREE_PATH,
        type: 'history',
        navigation: navigationWithStoreActions(),
      }),
    ).resolves.toBe(true)

    expect(openTabsFor('feature/worktree')).toContain('history')
    expect(preferredWorkspacePaneTab()).toBe('history')
    expect(refreshRuntimeProjection).not.toHaveBeenCalled()
  })

  test('records the active tab as the opener when opening a new static tab', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'files',
      workspacePaneTabsByBranch: {
        'feature/worktree': [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('files')],
      },
    })

    await expect(
      openWorkspacePaneTab({
        repoId: REPO_ID,
        branchName: 'feature/worktree',
        worktreePath: WORKTREE_PATH,
        type: 'changes',
        navigation: navigationWithStoreActions(),
      }),
    ).resolves.toBe(true)

    expect(
      useReposStore.getState().tabOpenerIdentityByScope[tabOpenerScopeKey(REPO_ID, 'feature/worktree')]?.[
        'workspace-pane:changes'
      ],
    ).toBe('workspace-pane:files')
  })

  test('does not overwrite the recorded opener when refocusing an already-open static tab', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'files',
      workspacePaneTabsByBranch: {
        'feature/worktree': [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('files')],
      },
    })
    await openWorkspacePaneTab({
      repoId: REPO_ID,
      branchName: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
      type: 'changes',
      navigation: navigationWithStoreActions(),
    })

    // Switch away, then "reopen" (i.e. just refocus) the already-open
    // changes tab from a different tab — the original opener must stick.
    useReposStore.getState().setWorkspacePaneTab(REPO_ID, 'feature/worktree', 'history')
    await openWorkspacePaneTab({
      repoId: REPO_ID,
      branchName: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
      type: 'changes',
      navigation: navigationWithStoreActions(),
    })

    expect(
      useReposStore.getState().tabOpenerIdentityByScope[tabOpenerScopeKey(REPO_ID, 'feature/worktree')]?.[
        'workspace-pane:changes'
      ],
    ).toBe('workspace-pane:files')
  })

  test('records the opener under the branch the operation targeted, even if the user switches branches while the commit is in flight', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/a', { worktree: { path: WORKTREE_PATH } }), createRepoBranch('feature/b')],
      currentBranchName: 'feature/a',
      preferredWorkspacePaneTab: 'files',
      workspacePaneTabsByBranch: {
        'feature/a': [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('files')],
      },
    })
    let resolveCommit!: (tabs: ReturnType<typeof workspacePaneStaticTabEntry>[]) => void
    let resolveCommitStarted!: () => void
    const commitStarted = new Promise<void>((resolve) => {
      resolveCommitStarted = resolve
    })
    installWorkspacePaneTabsTestBridge({
      updateWorkspaceTabs: () => {
        resolveCommitStarted()
        return new Promise((resolve) => {
          resolveCommit = resolve
        })
      },
    })

    const openPromise = openWorkspacePaneTab({
      repoId: REPO_ID,
      branchName: 'feature/a',
      worktreePath: WORKTREE_PATH,
      type: 'changes',
      navigation: navigationWithStoreActions(),
    })
    await commitStarted

    resolveCommit([
      workspacePaneStaticTabEntry('status'),
      workspacePaneStaticTabEntry('files'),
      workspacePaneStaticTabEntry('changes'),
    ])
    await openPromise

    const openers = useReposStore.getState().tabOpenerIdentityByScope
    // Recorded under feature/a (the branch the operation targeted)...
    expect(openers[tabOpenerScopeKey(REPO_ID, 'feature/a')]?.['workspace-pane:changes']).toBe('workspace-pane:files')
    // ...never under feature/b (the branch that merely happened to be
    // selected by the time the commit resolved).
    expect(openers[tabOpenerScopeKey(REPO_ID, 'feature/b')]).toBeUndefined()
  })

  test('does not record an opener if the repo closes before the open commit resolves', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/a', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/a',
      preferredWorkspacePaneTab: 'files',
      workspacePaneTabsByBranch: {
        'feature/a': [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('files')],
      },
    })
    let resolveCommit!: (tabs: ReturnType<typeof workspacePaneStaticTabEntry>[]) => void
    let resolveCommitStarted!: () => void
    const commitStarted = new Promise<void>((resolve) => {
      resolveCommitStarted = resolve
    })
    installWorkspacePaneTabsTestBridge({
      updateWorkspaceTabs: () => {
        resolveCommitStarted()
        return new Promise((resolve) => {
          resolveCommit = resolve
        })
      },
    })

    const openPromise = openWorkspacePaneTab({
      repoId: REPO_ID,
      branchName: 'feature/a',
      worktreePath: WORKTREE_PATH,
      type: 'changes',
      navigation: navigationWithStoreActions(),
    })
    await commitStarted

    useReposStore.getState().closeRepo(REPO_ID)
    resolveCommit([
      workspacePaneStaticTabEntry('status'),
      workspacePaneStaticTabEntry('files'),
      workspacePaneStaticTabEntry('changes'),
    ])
    await expect(openPromise).resolves.toBe(false)

    expect(useReposStore.getState().tabOpenerIdentityByScope[tabOpenerScopeKey(REPO_ID, 'feature/a')]).toBeUndefined()
  })

  test('does not select a stale opened tab after the repo closes and reopens before the commit resolves', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/a', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/a',
      preferredWorkspacePaneTab: 'files',
      workspacePaneTabsByBranch: {
        'feature/a': [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('files')],
      },
    })
    let resolveCommit!: (tabs: ReturnType<typeof workspacePaneStaticTabEntry>[]) => void
    let resolveCommitStarted!: () => void
    const commitStarted = new Promise<void>((resolve) => {
      resolveCommitStarted = resolve
    })
    installWorkspacePaneTabsTestBridge({
      updateWorkspaceTabs: () => {
        resolveCommitStarted()
        return new Promise((resolve) => {
          resolveCommit = resolve
        })
      },
    })

    const showRepoBranchWorkspacePaneTab = vi.fn((repoId, branch, tab) => {
      const state = useReposStore.getState()
      useReposStore.setState({ restoredRepoId: repoId })
      state.setWorkspacePaneTab(repoId, branch, tab)
    })

    const openPromise = openWorkspacePaneTab({
      repoId: REPO_ID,
      branchName: 'feature/a',
      worktreePath: WORKTREE_PATH,
      type: 'changes',
      navigation: {
        ...navigationWithStoreActions(),
        showRepoBranchWorkspacePaneTab,
      },
    })
    await commitStarted

    useReposStore.getState().closeRepo(REPO_ID)
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/reopened', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/reopened',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/reopened': [workspacePaneStaticTabEntry('status')],
      },
    })
    resolveCommit([
      workspacePaneStaticTabEntry('status'),
      workspacePaneStaticTabEntry('files'),
      workspacePaneStaticTabEntry('changes'),
    ])

    await expect(openPromise).resolves.toBe(false)

    expect(showRepoBranchWorkspacePaneTab).not.toHaveBeenCalled()
    expect(preferredWorkspacePaneTab()).toBe('status')
  })

  test('scopes recorded openers per repo/branch so identical static tab identities do not bleed across targets', async () => {
    const OTHER_REPO_ID = '/tmp/workspace-pane-tab-other-repo'
    const OTHER_WORKTREE_PATH = '/tmp/workspace-pane-tab-other-worktree'
    // seedRepoWithReadModelForTest replaces the whole `repos` map, so seed both repos
    // before merging them back together into one multi-repo store state.
    const repoA = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'files',
      workspacePaneTabsByBranch: {
        'feature/worktree': [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('files')],
      },
    })
    const repoB = seedRepoWithReadModelForTest({
      id: OTHER_REPO_ID,
      branches: [createRepoBranch('main', { worktree: { path: OTHER_WORKTREE_PATH } })],
      currentBranchName: 'main',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        main: [workspacePaneStaticTabEntry('status')],
      },
    })
    useReposStore.setState({
      repos: { [REPO_ID]: repoA, [OTHER_REPO_ID]: repoB },
      order: [REPO_ID, OTHER_REPO_ID],
      restoredRepoId: REPO_ID,
    })

    await openWorkspacePaneTab({
      repoId: REPO_ID,
      branchName: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
      type: 'changes',
      navigation: navigationWithStoreActions(),
    })
    // A second, unrelated repo also opens "changes" — this time from
    // "status". Both repos share the identity string `workspace-pane:changes`,
    // so without scoping this would clobber the first repo's recorded opener.
    await openWorkspacePaneTab({
      repoId: OTHER_REPO_ID,
      branchName: 'main',
      worktreePath: OTHER_WORKTREE_PATH,
      type: 'changes',
      navigation: navigationWithStoreActions(),
    })

    const openers = useReposStore.getState().tabOpenerIdentityByScope
    expect(openers[tabOpenerScopeKey(REPO_ID, 'feature/worktree')]?.['workspace-pane:changes']).toBe(
      'workspace-pane:files',
    )
    expect(openers[tabOpenerScopeKey(OTHER_REPO_ID, 'main')]?.['workspace-pane:changes']).toBe('workspace-pane:status')
  })

  test('serializes direct open calls so concurrent static tab opens do not overwrite each other', async () => {
    seedWorktreeRepo('status')

    await expect(
      Promise.all([
        openWorkspacePaneTab({
          repoId: REPO_ID,
          branchName: 'feature/worktree',
          worktreePath: WORKTREE_PATH,
          type: 'changes',
          navigation: navigationWithStoreActions(),
        }),
        openWorkspacePaneTab({
          repoId: REPO_ID,
          branchName: 'feature/worktree',
          worktreePath: WORKTREE_PATH,
          type: 'history',
          navigation: navigationWithStoreActions(),
        }),
      ]),
    ).resolves.toEqual([true, true])

    // Both opens anchor after "status" (the captured opener). The first commit
    // (changes) lands between status and history's slot; the second commit
    // (history) inserts immediately after status, pushing changes to position 3.
    expect(openTabsFor('feature/worktree')).toEqual(['status', 'history', 'changes'])
  })
})

function seedWorktreeRepo(preferredWorkspacePaneTab: WorkspacePaneStaticTabType) {
  seedRepoWithReadModelForTest({
    id: REPO_ID,
    branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
    currentBranchName: 'feature/worktree',
    preferredWorkspacePaneTab,
  })
}

function openTabsFor(branchName: string): WorkspacePaneStaticTabType[] {
  const repo = useReposStore.getState().repos[REPO_ID]
  const target = repo
    ? workspacePaneTabsTargetForRepoBranch(
        { repoRoot: repo.id, branches: readRepoBranchQueryProjection(repo)?.branches ?? [] },
        branchName,
      )
    : null
  return workspacePaneStaticTabsFromEntries(
    target ? readWorkspacePaneTabsForTarget({ ...target, repoInstanceId: repo.instanceId }) : [],
  )
}

function preferredWorkspacePaneTab(branchName = 'feature/worktree') {
  const repo = useReposStore.getState().repos[REPO_ID]
  return repo
    ? preferredWorkspacePaneTabForTarget(
        repo.ui,
        workspacePaneTabsTargetForRepoBranch(
          { repoRoot: repo.id, branches: readRepoBranchQueryProjection(repo)?.branches ?? [] },
          branchName,
        ),
      )
    : null
}

function navigationWithStoreActions(): Pick<PrimaryWindowNavigationActions, 'showRepoBranchWorkspacePaneTab'> {
  return {
    showRepoBranchWorkspacePaneTab: (repoId, branch, tab) => {
      const state = useReposStore.getState()
      useReposStore.setState({ restoredRepoId: repoId })
      state.setWorkspacePaneTab(repoId, branch, tab)
    },
  }
}
