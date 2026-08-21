// @vitest-environment jsdom

import {
  createRepoWorktreeSnapshotForTest,
  repoPresentationFromQueryForTest,
  resetWorkspacesStore,
  seedRepoWithReadModelForTest,
  createRepoBranch,
} from '#/web/test-utils/repo-store.ts'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { dispatchRemoveWorktree } from '#/web/hooks/branchActionDispatch.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import { appQueryClient } from '#/web/app/query-client.ts'

const REPO_ID = 'goblin+file:///tmp/goblin-branch-action-dispatch-repo'
const WORKTREE_PATH = '/tmp/goblin-branch-action-dispatch-worktree'

beforeEach(() => {
  appQueryClient.clear()
  resetWorkspacesStore()
})

afterEach(() => {
  appQueryClient.clear()
  resetWorkspacesStore()
})

describe('branch action dispatch', () => {
  test('remove worktree submits one server application command without client-side resource cleanup', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree')],
      worktrees: [
        createRepoWorktreeSnapshotForTest('feature/worktree', WORKTREE_PATH, { isPrimary: false, isLocked: false }),
      ],
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
    workspacesStore.setState({ runBranchAction })

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
      branches: [createRepoBranch('feature/worktree')],
      worktrees: [
        createRepoWorktreeSnapshotForTest('feature/worktree', WORKTREE_PATH, { isPrimary: false, isLocked: false }),
      ],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {},
    })
    const runBranchAction = vi.fn(async () => ({ ok: true, message: 'ok' }))
    workspacesStore.setState({ runBranchAction })

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

  test.each([
    {
      name: 'suppresses a bare cancellation',
      result: { ok: false as const, message: 'cancelled' },
      expected: null,
    },
    {
      name: 'returns a cancellation carrying confirmed recovery guidance',
      result: {
        ok: false as const,
        message: 'cancelled',
        recoveryMessageKeys: ['error.worktree-removed-followup-failed'] as const,
      },
      expected: {
        ok: false as const,
        message: 'cancelled',
        recoveryMessageKeys: ['error.worktree-removed-followup-failed'] as const,
      },
    },
  ])('$name', async ({ result, expected }) => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree')],
      worktrees: [
        createRepoWorktreeSnapshotForTest('feature/worktree', WORKTREE_PATH, { isPrimary: false, isLocked: false }),
      ],
      currentBranchName: 'feature/worktree',
    })
    workspacesStore.setState({ runBranchAction: vi.fn(async () => result) })

    await expect(
      dispatchRemoveWorktree({
        repo: repoPresentationFromQueryForTest(repo),
        target: { branch: 'feature/worktree', path: WORKTREE_PATH },
        deleteBranch: false,
        forceDeleteBranch: false,
        deleteUpstream: false,
      }),
    ).resolves.toEqual(expected)
  })
})
