import { beforeEach, describe, expect, test } from 'vitest'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { setRepoSnapshotQueryData } from '#/web/repo-data-query.ts'
import { resetReposStore, seedRepoState, createRepoBranch } from '#/web/test-utils/bridge.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { workspacePaneTabTargetForBranch } from '#/web/workspace-pane/workspace-pane-tab-target.ts'
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
  test('fails target resolution when the repo branch read model is unavailable', () => {
    const repo = emptyRepo(REPO_ID, 'workspace-pane-target-repo', 'repo-instance-workspace-pane-no-query')
    useReposStore.setState((s) => ({
      repos: { ...s.repos, [REPO_ID]: repo },
      order: [...s.order, REPO_ID],
      activeId: REPO_ID,
    }))

    expect(() => workspacePaneTabTargetForBranch(REPO_ID, 'feature/query')).toThrow(
      'repo branch read model query data unavailable for repo',
    )
  })

  test('resolves branch targets from the React Query snapshot cache when store branches are stale', () => {
    const repo = seedRepoState({
      id: REPO_ID,
      branches: [],
      selectedBranch: 'feature/query',
      preferredWorkspacePaneTab: 'status',
    })
    setRepoSnapshotQueryData(REPO_ID, repo.instanceId, {
      current: 'feature/query',
      branches: [createRepoBranch('feature/query', { worktree: { path: WORKTREE_PATH } })],
    })

    const target = workspacePaneTabTargetForBranch(REPO_ID, 'feature/query')

    expect(target?.branchName).toBe('feature/query')
    expect(target?.worktreePath).toBe(WORKTREE_PATH)
    expect(target?.renderedTab).toBe('status')
  })

  test('records tab openers from the React Query snapshot cache when store branches are stale', () => {
    const repo = seedRepoState({
      id: REPO_ID,
      branches: [],
      selectedBranch: 'feature/query',
    })
    setRepoSnapshotQueryData(REPO_ID, repo.instanceId, {
      current: 'feature/query',
      branches: [createRepoBranch('feature/query')],
    })

    recordWorkspacePaneTabOpener(REPO_ID, 'feature/query', 'workspace-pane:changes', 'workspace-pane:status')

    expect(
      useReposStore.getState().tabOpenerIdentityByScope[tabOpenerScopeKey(REPO_ID, 'feature/query')]?.[
        'workspace-pane:changes'
      ],
    ).toBe('workspace-pane:status')
  })

  test('fails opener recording when the repo branch read model is unavailable', () => {
    const repo = emptyRepo(REPO_ID, 'workspace-pane-target-repo', 'repo-instance-workspace-pane-no-query')
    useReposStore.setState((s) => ({
      repos: { ...s.repos, [REPO_ID]: repo },
      order: [...s.order, REPO_ID],
      activeId: REPO_ID,
    }))

    expect(() =>
      recordWorkspacePaneTabOpener(REPO_ID, 'feature/query', 'workspace-pane:changes', 'workspace-pane:status'),
    ).toThrow('repo branch read model query data unavailable for repo')
  })
})
