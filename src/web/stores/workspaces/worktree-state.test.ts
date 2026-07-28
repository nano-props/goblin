import { describe, expect, test } from 'vitest'
import { branchWorktreeChanges, branchWorktreeStatus } from '#/web/stores/workspaces/worktree-state.ts'
import { createBranchSnapshot } from '#/web/test-utils/repo-store.ts'
import type { WorktreeStatus } from '#/shared/git-types.ts'

const branch = createBranchSnapshot('feature/a', {
  worktree: { path: '/tmp/worktree-a', isPrimary: false, isLocked: true },
})

describe('branch worktree status selectors', () => {
  test('keeps change facts unknown while status is unavailable', () => {
    expect(branchWorktreeChanges(undefined, branch)).toBeUndefined()
    expect(branchWorktreeStatus(undefined, branch)).toBeUndefined()
  })

  test('keeps change facts unknown when accepted status does not contain the snapshot worktree', () => {
    expect(branchWorktreeChanges([], branch)).toBeUndefined()
    expect(branchWorktreeStatus([], branch)).toBeUndefined()
  })

  test('derives dirty and change count only from the matching accepted status entry', () => {
    const status: WorktreeStatus[] = [
      {
        path: '/tmp/worktree-a',
        branch: 'feature/a',
        isMain: false,
        entries: [
          { x: 'M', y: ' ', path: 'file-a.ts' },
          { x: '?', y: '?', path: 'file-b.ts' },
        ],
      },
    ]

    expect(branchWorktreeChanges(status, branch)).toEqual({ dirty: true, changeCount: 2 })
    expect(branchWorktreeStatus(status, branch)).toEqual(status)
  })

  test('represents an accepted clean worktree explicitly', () => {
    const status: WorktreeStatus[] = [{ path: '/tmp/worktree-a', branch: 'feature/a', isMain: false, entries: [] }]
    expect(branchWorktreeChanges(status, branch)).toEqual({ dirty: false, changeCount: 0 })
  })
})
