import { afterEach, describe, expect, test } from 'vitest'
import {
  branchActionBusyItemId,
  branchActionDisplayPhase,
  isBranchActionBlocked,
} from '#/renderer/hooks/branch-action-state.ts'
import { emptyRepo } from '#/renderer/stores/repos/helpers.ts'
import { markRepoOperationViews } from '#/renderer/stores/repos/operations.ts'
import { disposeRepoRuntime } from '#/renderer/stores/repos/runtime.ts'

const REPO_ID = '/tmp/gbl-branch-action-state'

afterEach(() => {
  disposeRepoRuntime(REPO_ID)
})

function markBranchAction(
  repo: ReturnType<typeof emptyRepo>,
  reason: Parameters<typeof markRepoOperationViews>[2][number]['reason'],
  target: string | null,
  phase: 'queued' | 'running' = 'running',
) {
  markRepoOperationViews(repo.operations, 1, [{ key: 'branchAction', reason, target }], phase)
}

describe('isBranchActionBlocked', () => {
  test('returns false while branch actions are idle', () => {
    const repo = emptyRepo(REPO_ID, 'repo')

    expect(isBranchActionBlocked(repo)).toBe(false)
  })

  test('uses repo branch action operation state for cross-button blocking', () => {
    const repo = emptyRepo('/tmp/gbl-branch-action-blocked', 'repo')
    markBranchAction(repo, 'branch:push', 'feature/a')

    expect(isBranchActionBlocked(repo)).toBe(true)
  })

  test('treats idle branch action operations as unblocked', () => {
    const repo = emptyRepo('/tmp/gbl-branch-action-queued', 'repo')

    expect(isBranchActionBlocked(repo)).toBe(false)
  })
})

describe('branchActionDisplayPhase', () => {
  test('returns queued for queued branch action operations', () => {
    const repo = emptyRepo(REPO_ID, 'repo')
    markBranchAction(repo, 'branch:pull', 'feature/a', 'queued')

    expect(branchActionDisplayPhase(repo, 'feature/a')).toBe('queued')
  })

  test('returns running for active branch actions', () => {
    const repo = emptyRepo(REPO_ID, 'repo')
    markBranchAction(repo, 'branch:push', 'feature/a')

    expect(branchActionDisplayPhase(repo, 'feature/a')).toBe('running')
  })
})

describe('branchActionBusyItemId', () => {
  test('maps operation-backed branch action reasons to UI actions', () => {
    const repo = emptyRepo('/tmp/gbl-branch-action-operation', 'repo')

    markBranchAction(repo, 'branch:checkout', 'feature/a')
    expect(branchActionBusyItemId(repo, 'feature/a')).toBe('checkout')

    markBranchAction(repo, 'branch:pull', 'feature/a')
    expect(branchActionBusyItemId(repo, 'feature/a')).toBe('pull')

    markBranchAction(repo, 'branch:push', 'feature/a')
    expect(branchActionBusyItemId(repo, 'feature/a')).toBe('push')

    markBranchAction(repo, 'branch:deleteBranch', 'feature/a')
    expect(branchActionBusyItemId(repo, 'feature/a')).toBe('deleteBranch')

    markBranchAction(repo, 'branch:removeWorktree', 'feature/a')
    expect(branchActionBusyItemId(repo, 'feature/a')).toBe('removeWorktree')
  })

  test('only marks the target branch action item as busy', () => {
    const repo = emptyRepo('/tmp/gbl-branch-action-operation-target', 'repo')

    markBranchAction(repo, 'branch:pull', 'feature/a')

    expect(branchActionBusyItemId(repo, 'feature/a')).toBe('pull')
    expect(branchActionBusyItemId(repo, 'feature/b')).toBeNull()
  })

  test('returns null when idle or when no branch action item owns the operation', () => {
    const repo = emptyRepo('/tmp/gbl-branch-action-operation-idle', 'repo')

    expect(branchActionBusyItemId(repo, 'feature/a')).toBeNull()

    markBranchAction(repo, 'branch:createWorktree', 'feature/a')
    expect(branchActionBusyItemId(repo, 'feature/a')).toBeNull()
  })
})
