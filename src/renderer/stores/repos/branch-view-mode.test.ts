import { describe, expect, test } from 'vitest'
import {
  branchForVisibleLog,
  branchMatchesViewMode,
  selectedBranchForBranchSet,
  selectedBranchForViewMode,
  visibleBranches,
} from '#/renderer/stores/repos/branch-view-mode.ts'
import { emptyRepo } from '#/renderer/stores/repos/helpers.ts'
import { createBranch as branch } from '#/renderer/stores/repos/test-utils.ts'
import type { BranchInfo } from '#/renderer/types.ts'
import type { BranchViewMode, RepoState } from '#/renderer/stores/repos/types.ts'

interface RepoOverrides {
  branches?: BranchInfo[]
  currentBranch?: string
  selectedBranch?: string | null
  branchViewMode?: BranchViewMode
}

function repo(overrides: RepoOverrides = {}): RepoState {
  const base = emptyRepo('/tmp/goblin-branch-view-mode-test', 'repo')
  return {
    ...base,
    data: {
      ...base.data,
      branches: overrides.branches ?? base.data.branches,
      currentBranch: overrides.currentBranch ?? base.data.currentBranch,
    },
    ui: {
      ...base.ui,
      selectedBranch: overrides.selectedBranch ?? base.ui.selectedBranch,
      branchViewMode: overrides.branchViewMode ?? base.ui.branchViewMode,
    },
  }
}

describe('branchMatchesViewMode', () => {
  test('matches worktree and no-worktree view modes from worktreePath', () => {
    const worktree = branch('feature/worktree', { worktreePath: '/tmp/feature-worktree' })
    const plain = branch('feature/plain')

    expect(branchMatchesViewMode(worktree, 'all')).toBe(true)
    expect(branchMatchesViewMode(plain, 'all')).toBe(true)
    expect(branchMatchesViewMode(worktree, 'worktrees')).toBe(true)
    expect(branchMatchesViewMode(plain, 'worktrees')).toBe(false)
    expect(branchMatchesViewMode(worktree, 'no-worktree')).toBe(false)
    expect(branchMatchesViewMode(plain, 'no-worktree')).toBe(true)
  })
})

describe('visibleBranches', () => {
  test('returns branches visible in the active repo view mode', () => {
    const branches = [branch('main', { worktreePath: '/repo' }), branch('feature/plain')]

    expect(visibleBranches(repo({ branches, branchViewMode: 'all' })).map((b) => b.name)).toEqual([
      'main',
      'feature/plain',
    ])
    expect(visibleBranches(repo({ branches, branchViewMode: 'worktrees' })).map((b) => b.name)).toEqual(['main'])
    expect(visibleBranches(repo({ branches, branchViewMode: 'no-worktree' })).map((b) => b.name)).toEqual([
      'feature/plain',
    ])
  })
})

describe('selectedBranchForViewMode', () => {
  const branches = [
    branch('main', { worktreePath: '/repo' }),
    branch('feature/worktree', { worktreePath: '/tmp/feature-worktree' }),
    branch('feature/plain'),
  ]

  function select(selectedBranch: string | null, viewMode: BranchViewMode): string | null {
    return selectedBranchForViewMode(
      repo({
        branches,
        currentBranch: 'main',
        selectedBranch,
      }),
      viewMode,
    )
  }

  test('keeps the current selection when it remains visible', () => {
    expect(select('feature/worktree', 'worktrees')).toBe('feature/worktree')
    expect(select('feature/plain', 'no-worktree')).toBe('feature/plain')
  })

  test('prefers the current branch when changing to a view mode that contains it', () => {
    expect(select('feature/plain', 'worktrees')).toBe('main')
  })

  test('falls back to the first visible branch when current branch is hidden', () => {
    expect(select('main', 'no-worktree')).toBe('feature/plain')
  })

  test('returns null when the view mode has no matches', () => {
    expect(
      selectedBranchForViewMode(repo({ branches: [branch('main')], currentBranch: 'main' }), 'worktrees'),
    ).toBeNull()
  })
})

describe('selectedBranchForBranchSet', () => {
  test('uses the same selection policy for non-store branch snapshots', () => {
    const branches = [branch('main', { worktreePath: '/repo' }), branch('feature/plain')]

    expect(
      selectedBranchForBranchSet({
        branches,
        currentBranch: 'main',
        selectedBranch: 'deleted-branch',
        viewMode: 'worktrees',
      }),
    ).toBe('main')
    expect(
      selectedBranchForBranchSet({
        branches,
        currentBranch: 'main',
        selectedBranch: 'deleted-branch',
        viewMode: 'no-worktree',
      }),
    ).toBe('feature/plain')
  })
})

describe('branchForVisibleLog', () => {
  test('falls back to the current branch only in the unfiltered mode', () => {
    expect(branchForVisibleLog(repo({ currentBranch: 'main', branchViewMode: 'all' }))).toBe('main')
    expect(branchForVisibleLog(repo({ currentBranch: 'main', branchViewMode: 'worktrees' }))).toBeNull()
    expect(branchForVisibleLog(repo({ currentBranch: 'main', branchViewMode: 'no-worktree' }))).toBeNull()
  })

  test('prefers an explicit selection in any mode', () => {
    expect(
      branchForVisibleLog(repo({ currentBranch: 'main', selectedBranch: 'feature', branchViewMode: 'no-worktree' })),
    ).toBe('feature')
  })
})
