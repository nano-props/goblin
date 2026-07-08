import { beforeEach, describe, expect, test } from 'vitest'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import {
  createRepoBranch,
  resetReposStore,
  seedRepoReadModelQueryData,
  seedRepoWithReadModelForTest,
} from '#/web/test-utils/bridge.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import { setWorkspacePaneTabsForTargetQueryData } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import {
  resolveWorkspacePaneTabTargetForBranch,
  workspacePanePreferenceTargetOptions,
  workspacePaneTabInteractionBlockedForBranch,
  workspacePaneTabTargetForBranch,
} from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import { recordWorkspacePaneTabOpener } from '#/web/workspace-pane/workspace-pane-tab-opener.ts'
import { tabOpenerScopeKey } from '#/web/stores/repos/tab-opener.ts'
import { emptyRepo } from '#/web/stores/repos/repo-state-factory.ts'

const REPO_ID = '/tmp/workspace-pane-target-repo'
const WORKTREE_PATH = '/tmp/workspace-pane-target-worktree'

beforeEach(() => {
  primaryWindowQueryClient.clear()
  resetReposStore()
})

describe('workspace pane tab target read model', () => {
  test('marks target resolution unavailable when the repo branch read model is unavailable', () => {
    const repo = emptyRepo(REPO_ID, 'workspace-pane-target-repo', 'repo-instance-workspace-pane-no-query')
    useReposStore.setState((s) => ({
      repos: { ...s.repos, [REPO_ID]: repo },
      order: [...s.order, REPO_ID],
      restoredRepoId: REPO_ID,
    }))

    expect(
      resolveWorkspacePaneTabTargetForBranch(REPO_ID, 'feature/query', workspacePanePreferenceTargetOptions),
    ).toEqual({
      kind: 'unavailable',
      reason: 'branch-read-model-unavailable',
    })
    expect(workspacePaneTabTargetForBranch(REPO_ID, 'feature/query', workspacePanePreferenceTargetOptions)).toBeNull()
  })

  test('marks target resolution unavailable while workspace pane tabs projection is not ready', () => {
    const repo = emptyRepo(REPO_ID, 'workspace-pane-target-repo', 'repo-instance-workspace-pane-no-tabs')
    useReposStore.setState((s) => ({
      repos: { ...s.repos, [REPO_ID]: repo },
      order: [...s.order, REPO_ID],
      restoredRepoId: REPO_ID,
    }))
    seedRepoReadModelQueryData(repo, {
      branches: [createRepoBranch('feature/query', { worktree: { path: WORKTREE_PATH } })],
      currentBranch: 'feature/query',
    })
    expect(
      resolveWorkspacePaneTabTargetForBranch(REPO_ID, 'feature/query', workspacePanePreferenceTargetOptions),
    ).toEqual({
      kind: 'unavailable',
      reason: 'workspace-pane-tabs-pending',
    })
    expect(workspacePaneTabTargetForBranch(REPO_ID, 'feature/query', workspacePanePreferenceTargetOptions)).toBeNull()
    expect(workspacePaneTabInteractionBlockedForBranch(REPO_ID, 'feature/query', workspacePanePreferenceTargetOptions)).toBe(
      true,
    )
  })

  test('resolves branch targets from the React Query projection when store branches are stale', () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [],
      currentBranchName: 'feature/query',
      preferredWorkspacePaneTab: 'status',
    })
    seedRepoReadModelQueryData(repo, {
      branches: [createRepoBranch('feature/query', { worktree: { path: WORKTREE_PATH } })],
      currentBranch: 'feature/query',
    })
    setWorkspacePaneTabsForTargetQueryData({
      repoRoot: REPO_ID,
      repoInstanceId: repo.instanceId,
      branchName: 'feature/query',
      worktreePath: WORKTREE_PATH,
      tabs: [workspacePaneStaticTabEntry('status')],
    })

    const target = workspacePaneTabTargetForBranch(REPO_ID, 'feature/query', workspacePanePreferenceTargetOptions)

    expect(target?.branchName).toBe('feature/query')
    expect(target?.worktreePath).toBe(WORKTREE_PATH)
    expect(target?.renderedTab).toBe('status')
  })

  test('treats an explicit bare branch route as an empty workspace pane', () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/query', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/query',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/query': [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('history')],
      },
    })

    const target = workspacePaneTabTargetForBranch(REPO_ID, 'feature/query', { workspacePaneRoute: null })

    expect(target?.tabs.map((tab) => tab.identity)).toEqual(['workspace-pane:status', 'workspace-pane:history'])
    expect(target?.activeTab).toBeNull()
    expect(target?.renderedTab).toBeNull()
  })

  test('records tab openers from the React Query projection when store branches are stale', () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [],
      currentBranchName: 'feature/query',
    })
    seedRepoReadModelQueryData(repo, {
      branches: [createRepoBranch('feature/query')],
      currentBranch: 'feature/query',
    })

    recordWorkspacePaneTabOpener(REPO_ID, 'feature/query', 'workspace-pane:changes', 'workspace-pane:status')

    expect(
      useReposStore.getState().tabOpenerIdentityByScope[tabOpenerScopeKey(REPO_ID, 'feature/query')]?.[
        'workspace-pane:changes'
      ],
    ).toBe('workspace-pane:status')
  })

  test('marks opener recording unavailable when the repo branch read model is unavailable', () => {
    const repo = emptyRepo(REPO_ID, 'workspace-pane-target-repo', 'repo-instance-workspace-pane-no-query')
    useReposStore.setState((s) => ({
      repos: { ...s.repos, [REPO_ID]: repo },
      order: [...s.order, REPO_ID],
      restoredRepoId: REPO_ID,
    }))

    expect(
      recordWorkspacePaneTabOpener(REPO_ID, 'feature/query', 'workspace-pane:changes', 'workspace-pane:status'),
    ).toBe('unavailable')
  })
})
