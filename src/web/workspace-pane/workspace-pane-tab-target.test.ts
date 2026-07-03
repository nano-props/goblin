import { beforeEach, describe, expect, test } from 'vitest'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { setRepoSnapshotQueryData } from '#/web/repo-data-query.ts'
import { resetReposStore, seedRepoState, createRepoBranch } from '#/web/test-utils/bridge.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { workspacePaneTabTargetForBranch } from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import { recordWorkspacePaneTabOpener } from '#/web/workspace-pane/workspace-pane-tab-opener.ts'
import { tabOpenerScopeKey } from '#/web/stores/repos/tab-opener.ts'

const REPO_ID = '/tmp/workspace-pane-target-repo'
const WORKTREE_PATH = '/tmp/workspace-pane-target-worktree'

beforeEach(() => {
  primaryWindowQueryClient.clear()
  resetReposStore()
})

describe('workspace pane tab target read model', () => {
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
})
