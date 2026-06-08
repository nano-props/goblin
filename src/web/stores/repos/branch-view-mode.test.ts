import { describe, expect, test } from 'vitest'
import { normalizeWorktreePathOrder, visibleBranches } from '#/web/stores/repos/branch-view-mode.ts'
import { createRepoBranch } from '#/web/stores/repos/test-utils.ts'

const branches = [
  createRepoBranch('main', { worktree: { path: '/repo' } }),
  createRepoBranch('feature/a', { worktree: { path: '/tmp/worktree-a' } }),
  createRepoBranch('feature/plain'),
  createRepoBranch('feature/b', { worktree: { path: '/tmp/worktree-b' } }),
]

describe('visibleBranches worktree ordering', () => {
  test('orders worktree view by saved worktree paths and appends new paths', () => {
    const visible = visibleBranches({
      branches,
      viewMode: 'worktrees',
      worktreePathOrder: ['/tmp/worktree-b', '/repo'],
    })

    expect(visible.map((branch) => branch.name)).toEqual(['feature/b', 'main', 'feature/a'])
  })

  test('orders all view worktrees first and preserves plain branch order after them', () => {
    const visible = visibleBranches({
      branches,
      viewMode: 'all',
      worktreePathOrder: ['/tmp/worktree-b', '/repo'],
    })

    expect(visible.map((branch) => branch.name)).toEqual(['feature/b', 'main', 'feature/a', 'feature/plain'])
  })

  test('keeps no-worktree view in branch snapshot order', () => {
    const visible = visibleBranches({
      branches,
      viewMode: 'no-worktree',
      worktreePathOrder: ['/tmp/worktree-b', '/repo'],
    })

    expect(visible.map((branch) => branch.name)).toEqual(['feature/plain'])
  })

  test('filters by search before applying saved order', () => {
    const visible = visibleBranches({
      branches,
      viewMode: 'worktrees',
      searchQuery: 'feature',
      worktreePathOrder: ['/tmp/worktree-b', '/repo', '/tmp/worktree-a'],
    })

    expect(visible.map((branch) => branch.name)).toEqual(['feature/b', 'feature/a'])
  })

  test('normalizes stale order paths against current worktree paths', () => {
    expect(normalizeWorktreePathOrder(['/stale', '/tmp/worktree-b'], ['/repo', '/tmp/worktree-b'])).toEqual([
      '/tmp/worktree-b',
      '/repo',
    ])
  })
})
