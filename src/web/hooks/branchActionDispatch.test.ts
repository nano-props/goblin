// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { dispatchRemoveWorktree } from '#/web/hooks/branchActionDispatch.ts'
import {
  createRepoBranch,
  repoPresentationFromQueryForTest,
  resetWorkspacesStore,
  seedRepoWithReadModelForTest,
} from '#/web/test-utils/bridge.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'

const REPO_ID = 'goblin+file:///tmp/goblin-branch-action-dispatch-repo'
const WORKTREE_PATH = '/tmp/goblin-branch-action-dispatch-worktree'

beforeEach(() => {
  primaryWindowQueryClient.clear()
  resetWorkspacesStore()
})

afterEach(() => {
  primaryWindowQueryClient.clear()
  resetWorkspacesStore()
})

describe('branch action dispatch', () => {
  test('remove worktree submits one server application command without client-side resource cleanup', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: {
        'feature/worktree': [
          workspacePaneStaticTabEntry('status'),
          { type: 'terminal', runtimeSessionId: 'term-111111111111111111111' },
        ],
      },
    })
    const runBranchAction = vi.fn(async () => ({ ok: true, message: 'ok' }))
    useWorkspacesStore.setState({ runBranchAction })

    await expect(
      dispatchRemoveWorktree({
        repo: repoPresentationFromQueryForTest(repo),
        target: { branch: 'feature/worktree', path: WORKTREE_PATH },
        deleteBranch: false,
        forceDeleteBranch: false,
        deleteUpstream: false,
      }),
    ).resolves.toEqual({ ok: true, message: 'ok' })

    expect(runBranchAction).toHaveBeenCalledWith(
      REPO_ID,
      {
        kind: 'removeWorktree',
        branch: 'feature/worktree',
        worktreePath: WORKTREE_PATH,
        deleteBranch: false,
        forceDeleteBranch: false,
        deleteUpstream: false,
      },
      {
        workspaceRuntimeId: repo.workspaceRuntimeId,
        deferResultMessages: [],
      },
    )
  })

  test('remove worktree proceeds when no workspace tabs are open', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {},
    })
    const runBranchAction = vi.fn(async () => ({ ok: true, message: 'ok' }))
    useWorkspacesStore.setState({ runBranchAction })

    await expect(
      dispatchRemoveWorktree({
        repo: repoPresentationFromQueryForTest(repo),
        target: { branch: 'feature/worktree', path: WORKTREE_PATH },
        deleteBranch: false,
        forceDeleteBranch: false,
        deleteUpstream: false,
      }),
    ).resolves.toEqual({ ok: true, message: 'ok' })

    expect(runBranchAction).toHaveBeenCalled()
  })
})
