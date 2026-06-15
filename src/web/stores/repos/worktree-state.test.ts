import { describe, expect, test } from 'vitest'
import {
  applyStatusToWorktreeStates,
  branchWorktreeHasChanges,
  getBranchWorktreeState,
  stripBranchWorktreeMetadata,
  worktreeStatesFromBranches,
} from '#/web/stores/repos/worktree-state.ts'
import { emptyRepo } from '#/web/stores/repos/helpers.ts'
import { createBranchSnapshot, createRepoBranch } from '#/web/stores/repos/test-utils.ts'
function assertRepoBranchStateTypeGuards() {
  createRepoBranch('feature/a', {
    worktree: {
      path: '/tmp/worktree-a',
      // @ts-expect-error renderer branch state must not include snapshot worktree summary
      summary: { dirty: true },
    },
  })
  createRepoBranch('feature/a', {
    worktree: {
      path: '/tmp/worktree-a',
      // @ts-expect-error renderer branch state must not include snapshot worktree metadata
      isPrimary: true,
    },
  })
  createRepoBranch('feature/a', {
    worktree: {
      path: '/tmp/worktree-a',
      // @ts-expect-error renderer branch state must not include snapshot worktree metadata
      isLocked: true,
    },
  })
}

void assertRepoBranchStateTypeGuards

describe('worktree state selectors', () => {
  test('uses status entries over branch snapshot dirty metadata', () => {
    const branches = [
      createBranchSnapshot('feature/a', {
        worktree: {
          path: '/tmp/worktree-a',
          summary: {
            dirty: true,
            changeCount: 3,
          },
        },
      }),
    ]

    const worktreesByPath = worktreeStatesFromBranches(branches, {}, [
      { path: '/tmp/worktree-a', branch: 'feature/a', isMain: false, entries: [] },
    ])

    expect(worktreesByPath['/tmp/worktree-a']).toMatchObject({
      isDirty: false,
      changeCount: 0,
    })
  })

  test('uses status metadata when branch state only has a worktree path', () => {
    const branches = [createRepoBranch('main', { worktree: { path: '/tmp/repo' } })]

    const worktreesByPath = worktreeStatesFromBranches(branches, {}, [
      { path: '/tmp/repo', branch: 'main', isMain: true, entries: [] },
    ])

    expect(worktreesByPath['/tmp/repo']).toMatchObject({
      branch: 'main',
      isMain: true,
      isDirty: false,
      changeCount: 0,
    })
  })

  test('keeps previous worktree state when status omits a worktree', () => {
    const previous = worktreeStatesFromBranches([
      createBranchSnapshot('feature/a', {
        worktree: {
          path: '/tmp/worktree-a',
          summary: {
            dirty: true,
            changeCount: 2,
          },
        },
      }),
    ])

    const next = applyStatusToWorktreeStates(previous, [
      { path: '/tmp/worktree-b', branch: 'feature/b', isMain: false, entries: [] },
    ])

    expect(next['/tmp/worktree-a']).toMatchObject({
      isDirty: true,
      changeCount: 2,
    })
  })

  test('strips worktree metadata from branch state while preserving canonical state', () => {
    const snapshot = createBranchSnapshot('feature/a', {
      worktree: {
        path: '/tmp/worktree-a',
        isPrimary: true,
        isLocked: true,
        summary: {
          dirty: true,
          changeCount: 2,
        },
      },
    })

    const [branch] = stripBranchWorktreeMetadata([snapshot])
    const worktreesByPath = worktreeStatesFromBranches([snapshot])

    expect(branch?.worktree).toEqual({ path: '/tmp/worktree-a' })
    expect(branch?.worktree).not.toHaveProperty('summary')
    expect(branch?.worktree).not.toHaveProperty('isPrimary')
    expect(branch?.worktree).not.toHaveProperty('isLocked')
    expect(worktreesByPath['/tmp/worktree-a']).toMatchObject({
      isMain: true,
      isLocked: true,
      isDirty: true,
      changeCount: 2,
    })
  })

  test('does not read stripped snapshot metadata from branch state', () => {
    const repo = emptyRepo('/tmp/repo', 'repo')
    const branch = createRepoBranch('feature/a', { worktree: { path: '/tmp/worktree-a' } })

    expect(getBranchWorktreeState(repo, branch)).toMatchObject({
      dirty: false,
      changeCount: 0,
    })
  })

  test('falls back to a generic dirty change count when exact metadata is unavailable', () => {
    const repo = emptyRepo('/tmp/repo', 'repo')
    const snapshot = createBranchSnapshot('feature/a', {
      worktree: {
        path: '/tmp/worktree-a',
        summary: {
          dirty: true,
        },
      },
    })

    repo.data.worktreesByPath = worktreeStatesFromBranches([snapshot])
    const branch = createRepoBranch('feature/a', { worktree: { path: '/tmp/worktree-a' } })

    expect(getBranchWorktreeState(repo, branch)).toMatchObject({
      dirty: true,
      changeCount: 1,
    })
  })
})

describe('branchWorktreeHasChanges', () => {
  test('returns false when the branch has no worktree', () => {
    const repo = emptyRepo('/tmp/repo', 'repo')
    const branch = createRepoBranch('feature/a')

    expect(branchWorktreeHasChanges(repo, branch)).toBe(false)
  })

  test('returns true when status entries exist for the worktree path', () => {
    const repo = emptyRepo('/tmp/repo', 'repo')
    const branch = createRepoBranch('feature/a', { worktree: { path: '/tmp/worktree-a' } })

    repo.data.status = [
      { path: '/tmp/worktree-a', branch: 'feature/a', isMain: false, entries: [{ x: 'M', y: ' ', path: 'a.ts' }] },
    ]

    expect(branchWorktreeHasChanges(repo, branch)).toBe(true)
  })

  test('returns true when only worktree metadata indicates a dirty state', () => {
    const repo = emptyRepo('/tmp/repo', 'repo')
    const snapshot = createBranchSnapshot('feature/a', {
      worktree: {
        path: '/tmp/worktree-a',
        summary: { dirty: true, changeCount: 4 },
      },
    })
    repo.data.worktreesByPath = worktreeStatesFromBranches([snapshot])
    const branch = createRepoBranch('feature/a', { worktree: { path: '/tmp/worktree-a' } })

    expect(branchWorktreeHasChanges(repo, branch)).toBe(true)
  })

  test('returns false for a clean worktree with no status entries', () => {
    const repo = emptyRepo('/tmp/repo', 'repo')
    const branch = createRepoBranch('feature/a', { worktree: { path: '/tmp/worktree-a' } })

    expect(branchWorktreeHasChanges(repo, branch)).toBe(false)
  })
})
