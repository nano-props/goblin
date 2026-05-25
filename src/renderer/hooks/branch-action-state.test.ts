import { describe, expect, test } from 'vitest'
import { branchActionItemIdFromOperation, isBranchActionBlocked } from '#/renderer/hooks/branch-action-state.ts'
import { emptyRepo } from '#/renderer/stores/repos/helpers.ts'
import { startBranchActionResource } from '#/renderer/stores/repos/resources.ts'

describe('isBranchActionBlocked', () => {
  test('returns false while branch actions are idle', () => {
    const repo = emptyRepo('/tmp/gbl-branch-action-state', 'repo')

    expect(isBranchActionBlocked(repo)).toBe(false)
  })

  test('uses repo branch action resource state for cross-button blocking', () => {
    const repo = emptyRepo('/tmp/gbl-branch-action-blocked', 'repo')
    startBranchActionResource(repo.resources.branchAction, 'push', 'feature/a')

    expect(isBranchActionBlocked(repo)).toBe(true)
  })

  test('treats non-running branch action resources as unblocked', () => {
    const repo = emptyRepo('/tmp/gbl-branch-action-queued', 'repo')

    expect(isBranchActionBlocked(repo)).toBe(false)
  })
})

describe('branchActionItemIdFromOperation', () => {
  test('maps store-backed branch action resource kinds to UI actions', () => {
    const repo = emptyRepo('/tmp/gbl-branch-action-operation', 'repo')

    startBranchActionResource(repo.resources.branchAction, 'checkout', 'feature/a')
    expect(branchActionItemIdFromOperation(repo, 'feature/a')).toBe('checkout')

    startBranchActionResource(repo.resources.branchAction, 'pull', 'feature/a')
    expect(branchActionItemIdFromOperation(repo, 'feature/a')).toBe('pull')

    startBranchActionResource(repo.resources.branchAction, 'push', 'feature/a')
    expect(branchActionItemIdFromOperation(repo, 'feature/a')).toBe('push')

    startBranchActionResource(repo.resources.branchAction, 'deleteBranch', 'feature/a')
    expect(branchActionItemIdFromOperation(repo, 'feature/a')).toBe('deleteBranch')

    startBranchActionResource(repo.resources.branchAction, 'removeWorktree', 'feature/a')
    expect(branchActionItemIdFromOperation(repo, 'feature/a')).toBe('removeWorktree')
  })

  test('only marks the target branch action item as busy', () => {
    const repo = emptyRepo('/tmp/gbl-branch-action-operation-target', 'repo')

    startBranchActionResource(repo.resources.branchAction, 'pull', 'feature/a')

    expect(branchActionItemIdFromOperation(repo, 'feature/a')).toBe('pull')
    expect(branchActionItemIdFromOperation(repo, 'feature/b')).toBeNull()
  })

  test('returns null when idle or when no branch action item owns the operation', () => {
    const repo = emptyRepo('/tmp/gbl-branch-action-operation-idle', 'repo')

    expect(branchActionItemIdFromOperation(repo, 'feature/a')).toBeNull()

    startBranchActionResource(repo.resources.branchAction, 'createWorktree', 'feature/a')
    expect(branchActionItemIdFromOperation(repo, 'feature/a')).toBeNull()
  })
})
