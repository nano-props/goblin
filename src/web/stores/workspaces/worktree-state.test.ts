import { describe, expect, test } from 'vitest'
import { worktreeChanges, worktreeStatus } from '#/web/stores/workspaces/worktree-state.ts'
import type { WorktreeStatus } from '#/shared/git-types.ts'

const worktreePath = '/tmp/worktree-a'

describe('branch worktree status selectors', () => {
  test('keeps change facts unknown while status is unavailable', () => {
    expect(worktreeChanges(undefined, worktreePath)).toBeUndefined()
    expect(worktreeStatus(undefined, worktreePath)).toBeUndefined()
  })

  test('keeps change facts unknown when accepted status does not contain the snapshot worktree', () => {
    expect(worktreeChanges([], worktreePath)).toBeUndefined()
    expect(worktreeStatus([], worktreePath)).toBeUndefined()
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

    expect(worktreeChanges(status, worktreePath)).toEqual({ dirty: true, changeCount: 2 })
    expect(worktreeStatus(status, worktreePath)).toEqual(status)
  })

  test('represents an accepted clean worktree explicitly', () => {
    const status: WorktreeStatus[] = [{ path: '/tmp/worktree-a', branch: 'feature/a', isMain: false, entries: [] }]
    expect(worktreeChanges(status, worktreePath)).toEqual({ dirty: false, changeCount: 0 })
  })
})
