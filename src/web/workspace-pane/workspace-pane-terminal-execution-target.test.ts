import { beforeEach, describe, expect, test, vi } from 'vitest'
import { canonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'
import { createRepoBranch, resetReposStore, seedRepoWithReadModelForTest } from '#/web/test-utils/bridge.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import {
  createWorkspacePaneTerminalExecutionTargetResolver,
  resolveWorkspacePaneTerminalExecutionTarget,
} from '#/web/workspace-pane/workspace-pane-terminal-execution-target.ts'

const REPO_ID = 'goblin+file:///workspace/project'
const REPO_RUNTIME_ID = 'repo-runtime-test'
const WORKTREE_PATH = '/workspace/project-worktree'

describe('workspace pane terminal execution target resolver', () => {
  beforeEach(() => resetReposStore())

  test('returns null for a missing branch and for a branch without a worktree', () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      repoRuntimeId: REPO_RUNTIME_ID,
      branches: [createRepoBranch('branch-only')],
      currentBranchName: 'branch-only',
    })

    expect(resolveWorkspacePaneTerminalExecutionTarget(REPO_ID, 'missing')).toBeNull()
    expect(resolveWorkspacePaneTerminalExecutionTarget(REPO_ID, 'branch-only')).toBeNull()
  })

  test('follows an authoritative branch rename without retaining the old name', () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      repoRuntimeId: REPO_RUNTIME_ID,
      branches: [createRepoBranch('renamed', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'renamed',
    })

    expect(resolveWorkspacePaneTerminalExecutionTarget(REPO_ID, 'previous-name')).toBeNull()
    expect(resolveWorkspacePaneTerminalExecutionTarget(REPO_ID, 'renamed')).toEqual({
      target: {
        kind: 'git-worktree',
        workspaceId: canonicalWorkspaceLocator(REPO_ID),
        workspaceRuntimeId: REPO_RUNTIME_ID,
        root: canonicalWorkspaceLocator(`goblin+file://${WORKTREE_PATH}`),
      },
      presentation: { kind: 'git-worktree', branchName: 'renamed' },
    })
  })

  test('resolves a plain workspace without reading the Git projection', () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      repoRuntimeId: REPO_RUNTIME_ID,
      branches: [],
      currentBranchName: null,
    })
    const readGitWorktree = vi.fn(() => null)
    const resolve = createWorkspacePaneTerminalExecutionTargetResolver({
      readRepo: (repoId) => useReposStore.getState().repos[repoId],
      readGitWorktree,
    })

    expect(resolve(repo.id, null)).toEqual({
      target: {
        kind: 'workspace-root',
        workspaceId: canonicalWorkspaceLocator(REPO_ID),
        workspaceRuntimeId: REPO_RUNTIME_ID,
      },
      presentation: { kind: 'workspace-root' },
    })
    expect(readGitWorktree).not.toHaveBeenCalled()
  })
})
