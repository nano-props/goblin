import { describe, expect, test } from 'vitest'
import { validateBranchDeletionPolicy, validateRemovableWorktreeState } from '#/shared/repo-action-policy.ts'

describe('validateRemovableWorktreeState', () => {
  test('accepts a clean unlocked worktree', () => {
    expect(
      validateRemovableWorktreeState({
        path: '/tmp/repo-feature',
        branch: 'feature/test',
        isBare: false,
        isPrimary: false,
        isDirty: false,
      }),
    ).toBeNull()
  })

  test('rejects locked worktrees', () => {
    expect(
      validateRemovableWorktreeState({
        path: '/tmp/repo-feature',
        branch: 'feature/test',
        isBare: false,
        isPrimary: false,
        isDirty: false,
        isLocked: true,
      }),
    ).toEqual({
      ok: false,
      message: 'error.cannot-remove-locked-worktree',
    })
  })

  test('rejects dirty or unreadable worktrees', () => {
    expect(
      validateRemovableWorktreeState({
        path: '/tmp/repo-feature',
        branch: 'feature/test',
        isBare: false,
        isPrimary: false,
        isDirty: true,
      }),
    ).toEqual({
      ok: false,
      message: 'error.cannot-remove-dirty-worktree',
    })
    expect(
      validateRemovableWorktreeState({
        path: '/tmp/repo-feature',
        branch: 'feature/test',
        isBare: false,
        isPrimary: false,
      }),
    ).toEqual({
      ok: false,
      message: 'error.cannot-remove-dirty-worktree',
    })
  })
})

describe('validateBranchDeletionPolicy', () => {
  test('rejects the current branch first', () => {
    expect(validateBranchDeletionPolicy({ branch: 'feature/test', currentBranch: 'feature/test' })).toEqual({
      ok: false,
      message: 'error.cannot-delete-current-branch',
    })
  })

  test('rejects protected branches', () => {
    expect(validateBranchDeletionPolicy({ branch: 'main', currentBranch: 'feature/test' })).toEqual({
      ok: false,
      message: 'error.cannot-delete-protected-branch',
    })
  })

  test('rejects branches checked out elsewhere', () => {
    expect(
      validateBranchDeletionPolicy({
        branch: 'feature/test',
        currentBranch: 'release/1.0',
        isCheckedOutElsewhere: true,
      }),
    ).toEqual({
      ok: false,
      message: 'error.cannot-delete-checked-out-branch',
    })
  })

  test('maps non-merged branches to the requested error key', () => {
    expect(
      validateBranchDeletionPolicy({
        branch: 'feature/test',
        currentBranch: 'release/1.0',
        notMergedMessage: 'error.cannot-remove-unpushed-worktree',
      }),
    ).toEqual({
      ok: false,
      message: 'error.cannot-remove-unpushed-worktree',
    })
    expect(
      validateBranchDeletionPolicy({
        branch: 'feature/test',
        currentBranch: 'release/1.0',
      }),
    ).toEqual({
      ok: false,
      message: 'error.branch-not-fully-merged',
    })
  })

  test('accepts merged branches or forced deletes', () => {
    expect(
      validateBranchDeletionPolicy({
        branch: 'feature/test',
        currentBranch: 'release/1.0',
        mergedToCurrent: true,
      }),
    ).toBeNull()
    expect(
      validateBranchDeletionPolicy({
        branch: 'feature/test',
        currentBranch: 'release/1.0',
        force: true,
      }),
    ).toBeNull()
  })
})
