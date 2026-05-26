import { describe, expect, test } from 'vitest'
import { repoBranchActionLoadingLabel, repoEventActionSuccessLabel } from '#/renderer/stores/repos/action-labels.ts'

describe('repoBranchActionLoadingLabel', () => {
  test('returns loading labels for branch actions', () => {
    expect(repoBranchActionLoadingLabel('checkout')).toEqual({
      labelKey: 'action.checkout-loading',
    })
    expect(repoBranchActionLoadingLabel('pull')).toEqual({
      labelKey: 'action.pull-loading',
    })
    expect(repoBranchActionLoadingLabel('push')).toEqual({
      labelKey: 'action.push-loading',
    })
    expect(repoBranchActionLoadingLabel('createWorktree')).toEqual({
      labelKey: 'action.create-worktree-creating-title',
    })
    expect(repoBranchActionLoadingLabel('deleteBranch')).toEqual({
      labelKey: 'action.delete-branch-deleting-title',
    })
    expect(repoBranchActionLoadingLabel('removeWorktree')).toEqual({
      labelKey: 'action.remove-worktree-removing-title',
    })
  })

  test('omits label params', () => {
    expect(repoBranchActionLoadingLabel('checkout')).toEqual({
      labelKey: 'action.checkout-loading',
    })
  })
})

describe('repoEventActionSuccessLabel', () => {
  test('returns precise success labels for worktree and branch deletion actions', () => {
    expect(
      repoEventActionSuccessLabel({
        kind: 'createWorktree',
        branch: 'feature/new',
        worktreePath: '/tmp/worktree',
      }),
    ).toEqual({
      labelKey: 'action.create-worktree-created-title',
    })
    expect(
      repoEventActionSuccessLabel({
        kind: 'removeWorktree',
        branch: 'feature/remove',
        worktreePath: '/tmp/worktree',
        alsoDeleteBranch: false,
      }),
    ).toEqual({
      labelKey: 'action.remove-worktree-removed-title',
    })
    expect(
      repoEventActionSuccessLabel({
        kind: 'removeWorktree',
        branch: 'feature/remove',
        worktreePath: '/tmp/worktree',
        alsoDeleteBranch: true,
      }),
    ).toEqual({
      labelKey: 'action.remove-worktree-removed-with-branch-title',
    })
    expect(repoEventActionSuccessLabel({ kind: 'deleteBranch', branch: 'feature/delete' })).toEqual({
      labelKey: 'action.delete-branch-deleted-title',
    })
  })

  test('keeps unrelated branch actions on the generic success title', () => {
    expect(repoEventActionSuccessLabel({ kind: 'checkout', branch: 'feature/a' })).toBeNull()
    expect(repoEventActionSuccessLabel({ kind: 'pull', branch: 'feature/a' })).toBeNull()
    expect(repoEventActionSuccessLabel({ kind: 'push', branch: 'feature/a' })).toBeNull()
  })
})
