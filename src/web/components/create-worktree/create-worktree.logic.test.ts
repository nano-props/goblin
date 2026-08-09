import { describe, expect, test } from 'vitest'
import { initialCreateWorktreeBase } from '#/web/components/create-worktree/create-worktree.logic.ts'

describe('initialCreateWorktreeBase', () => {
  test('prefers the current branch', () => {
    expect(
      initialCreateWorktreeBase({
        current: 'feature/current',
        branches: [{ name: 'main' }, { name: 'feature/current' }],
      }),
    ).toBe('feature/current')
  })

  test('falls back to the first branch when HEAD is detached', () => {
    expect(initialCreateWorktreeBase({ current: '', branches: [{ name: 'main' }] })).toBe('main')
  })

  test('returns an empty value when no branch is available', () => {
    expect(initialCreateWorktreeBase({ current: '', branches: [] })).toBe('')
  })
})
