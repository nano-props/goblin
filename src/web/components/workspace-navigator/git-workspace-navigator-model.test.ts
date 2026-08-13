import { describe, expect, test } from 'vitest'
import {
  gitWorkspaceNavigatorRowIdentity,
  gitWorkspaceNavigatorRows,
} from '#/web/components/workspace-navigator/git-workspace-navigator-model.ts'
import { createRepoBranch, createRepoWorktreeSnapshotForTest } from '#/web/test-utils/repo-store.ts'

const WORKTREE_PATH = '/tmp/feature-worktree'

describe('gitWorkspaceNavigatorRows', () => {
  test('uses a materialized worktree as the target identity at its branch position', () => {
    const branches = [createRepoBranch('main'), createRepoBranch('feature/example'), createRepoBranch('later')]
    const rows = gitWorkspaceNavigatorRows({
      branches,
      worktrees: [createRepoWorktreeSnapshotForTest('feature/example', WORKTREE_PATH)],
      viewMode: 'all',
    })

    expect(rows.map(gitWorkspaceNavigatorRowIdentity)).toEqual([
      { kind: 'branch', branchName: 'main' },
      { kind: 'worktree', worktreePath: WORKTREE_PATH },
      { kind: 'branch', branchName: 'later' },
    ])
  })

  test('preserves a rebasing worktree identity and position while changing its presentation', () => {
    const branches = [createRepoBranch('main'), createRepoBranch('feature/example'), createRepoBranch('later')]
    const worktree = {
      ...createRepoWorktreeSnapshotForTest('feature/example', WORKTREE_PATH),
      head: { kind: 'detached' as const },
      operation: { kind: 'rebase' as const },
    }
    const rows = gitWorkspaceNavigatorRows({ branches, worktrees: [worktree], viewMode: 'all' })

    expect(rows.map(gitWorkspaceNavigatorRowIdentity)).toEqual([
      { kind: 'branch', branchName: 'main' },
      { kind: 'worktree', worktreePath: WORKTREE_PATH },
      { kind: 'branch', branchName: 'later' },
    ])
    expect(rows[1]).toEqual({ kind: 'worktree', worktree, branch: branches[1] })
  })

  test('keeps an unowned detached worktree reachable after the branch rows', () => {
    const branches = [createRepoBranch('main'), createRepoBranch('feature/example')]
    const worktree = {
      ...createRepoWorktreeSnapshotForTest('feature/example', WORKTREE_PATH),
      head: { kind: 'detached' as const },
      operation: null,
      materializedBranch: null,
    }

    expect(
      gitWorkspaceNavigatorRows({ branches, worktrees: [worktree], viewMode: 'all' }).map(
        gitWorkspaceNavigatorRowIdentity,
      ),
    ).toEqual([
      { kind: 'branch', branchName: 'main' },
      { kind: 'branch', branchName: 'feature/example' },
      { kind: 'worktree', worktreePath: WORKTREE_PATH },
    ])
  })

  test('keeps an attached worktree reachable when its branch projection is absent', () => {
    const worktree = {
      ...createRepoWorktreeSnapshotForTest('main', WORKTREE_PATH),
      headOid: null,
    }

    expect(
      gitWorkspaceNavigatorRows({ branches: [], worktrees: [worktree], viewMode: 'all' }).map(
        gitWorkspaceNavigatorRowIdentity,
      ),
    ).toEqual([{ kind: 'worktree', worktreePath: WORKTREE_PATH }])
  })
})
