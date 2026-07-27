import { describe, expect, test } from 'vitest'
import {
  applyStatusToWorktreeStates,
  branchWorktreeHasChanges,
  getBranchWorktreeState,
  stripBranchWorktreeMetadata,
  worktreeStatesFromBranchReadModel,
  type BranchWorktreeRepo,
} from '#/web/stores/workspaces/worktree-state.ts'
import { createBranchSnapshot, createRepoBranch } from '#/web/test-utils/bridge.ts'
import type { RepoWorktreeState } from '#/web/stores/workspaces/types.ts'
import type { WorktreeStatus } from '#/web/types.ts'

function assertRepoBranchStateTypeGuards() {
  createRepoBranch('feature/a', {
    worktree: {
      path: '/tmp/worktree-a',
      // @ts-expect-error client branch state must not include snapshot worktree metadata
      isPrimary: true,
    },
  })
  createRepoBranch('feature/a', {
    worktree: {
      path: '/tmp/worktree-a',
      // @ts-expect-error client branch state must not include snapshot worktree metadata
      isLocked: true,
    },
  })
}

void assertRepoBranchStateTypeGuards

describe('worktree state selectors', () => {
  test('builds branch worktree state from membership and dedicated status', () => {
    const branches = [
      createBranchSnapshot('feature/a', {
        worktree: { path: '/tmp/worktree-a', isPrimary: false, isLocked: true },
      }),
    ]

    const worktreesByPath = worktreeStatesFromBranchReadModel(branches, [
      {
        path: '/tmp/worktree-a',
        branch: 'feature/a',
        isMain: false,
        entries: [{ x: 'M', y: ' ', path: 'changed.ts' }],
      },
    ])

    expect(worktreesByPath['/tmp/worktree-a']).toEqual({
      path: '/tmp/worktree-a',
      branch: 'feature/a',
      isMain: false,
      isDirty: true,
      changeCount: 1,
      isLocked: true,
    })
  })

  test('does not invent dirty state when dedicated status is unavailable', () => {
    const branches = [createBranchSnapshot('feature/a', { worktree: { path: '/tmp/worktree-a' } })]

    expect(worktreeStatesFromBranchReadModel(branches, [])['/tmp/worktree-a']).toMatchObject({
      branch: 'feature/a',
      isDirty: false,
      changeCount: 0,
    })
  })

  test('keeps detached worktrees from the authoritative status catalog', () => {
    const worktreesByPath = worktreeStatesFromBranchReadModel(
      [],
      [
        {
          path: '/workspace/detached',
          isMain: false,
          entries: [{ x: 'M', y: ' ', path: 'changed.txt' }],
        },
      ],
    )

    expect(worktreesByPath['/workspace/detached']).toEqual({
      path: '/workspace/detached',
      branch: undefined,
      isMain: false,
      isDirty: true,
      changeCount: 1,
    })
  })

  test('keeps previous entries when applying a status snapshot for another worktree', () => {
    const previous: Record<string, RepoWorktreeState> = {
      '/tmp/worktree-a': {
        path: '/tmp/worktree-a',
        branch: 'feature/a',
        isMain: false,
        isDirty: true,
        changeCount: 2,
      },
    }

    const next = applyStatusToWorktreeStates(previous, [
      { path: '/tmp/worktree-b', branch: 'feature/b', isMain: false, entries: [] },
    ])

    expect(next['/tmp/worktree-a']).toEqual(previous['/tmp/worktree-a'])
  })

  test('strips membership metadata from client branch state', () => {
    const snapshot = createBranchSnapshot('feature/a', {
      worktree: { path: '/tmp/worktree-a', isPrimary: true, isLocked: true },
    })

    const [branch] = stripBranchWorktreeMetadata([snapshot])

    expect(branch?.worktree).toEqual({ path: '/tmp/worktree-a' })
    expect(branch?.worktree).not.toHaveProperty('isPrimary')
    expect(branch?.worktree).not.toHaveProperty('isLocked')
  })

  test('uses accepted worktree state when exact status entries are unavailable', () => {
    const repo = branchWorktreeRepo({
      worktreesByPath: {
        '/tmp/worktree-a': {
          path: '/tmp/worktree-a',
          branch: 'feature/a',
          isMain: false,
          isDirty: true,
          changeCount: 4,
        },
      },
    })
    const branch = createRepoBranch('feature/a', { worktree: { path: '/tmp/worktree-a' } })

    expect(getBranchWorktreeState(repo, branch)).toMatchObject({ dirty: true, changeCount: 4 })
  })
})

describe('branchWorktreeHasChanges', () => {
  test('returns false when the branch has no worktree', () => {
    expect(branchWorktreeHasChanges(branchWorktreeRepo(), createRepoBranch('feature/a'))).toBe(false)
  })

  test('returns true when status entries exist for the worktree path', () => {
    const branch = createRepoBranch('feature/a', { worktree: { path: '/tmp/worktree-a' } })
    const repo = branchWorktreeRepo({
      status: [
        { path: '/tmp/worktree-a', branch: 'feature/a', isMain: false, entries: [{ x: 'M', y: ' ', path: 'a.ts' }] },
      ],
    })

    expect(branchWorktreeHasChanges(repo, branch)).toBe(true)
  })

  test('returns false for a clean worktree with no status entries', () => {
    const branch = createRepoBranch('feature/a', { worktree: { path: '/tmp/worktree-a' } })
    expect(branchWorktreeHasChanges(branchWorktreeRepo(), branch)).toBe(false)
  })
})

function branchWorktreeRepo(
  options: { status?: WorktreeStatus[]; worktreesByPath?: Record<string, RepoWorktreeState> } = {},
): BranchWorktreeRepo {
  return {
    branchModel: {
      status: options.status ?? [],
      worktreesByPath: options.worktreesByPath ?? {},
    },
  }
}
