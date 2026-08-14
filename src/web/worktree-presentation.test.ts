import { describe, expect, test } from 'vitest'
import type { GitOperation } from '#/shared/git-types.ts'
import { worktreeOperationKey } from '#/web/worktree-presentation.ts'

describe('worktree operation presentation', () => {
  test.each([
    ['rebase', 'worktree-state.rebase'],
    ['merge', 'worktree-state.merge'],
    ['cherry-pick', 'worktree-state.cherry-pick'],
    ['revert', 'worktree-state.revert'],
    ['bisect', 'worktree-state.bisect'],
  ] satisfies [GitOperation['kind'], string][])('maps %s to its translation key', (kind, key) => {
    expect(worktreeOperationKey({ kind })).toBe(key)
  })
})
