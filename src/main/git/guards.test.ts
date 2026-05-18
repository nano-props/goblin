import { describe, expect, test } from 'bun:test'
import { resolveKnownWorktree } from '#/main/git/guards.ts'

describe('resolveKnownWorktree', () => {
  test('resolves a known worktree without a branch constraint', () => {
    const result = resolveKnownWorktree(
      [
        { path: '/repo', branch: 'main', isBare: false, isPrimary: true },
        { path: '/repo-linked', branch: 'feature', isBare: false, isPrimary: false },
      ],
      '/repo-linked',
    )
    expect(result).toEqual({ ok: true, path: '/repo-linked' })
  })

  test('rejects an unknown worktree path', () => {
    const result = resolveKnownWorktree(
      [{ path: '/repo', branch: 'main', isBare: false, isPrimary: true }],
      '/tmp/other',
    )
    expect(result).toEqual({ ok: false, message: 'error.invalidWorktreePath' })
  })

  test('rejects a known path checked out on a different branch', () => {
    const result = resolveKnownWorktree(
      [{ path: '/repo-linked', branch: 'feature', isBare: false, isPrimary: false }],
      '/repo-linked',
      'other',
    )
    expect(result).toEqual({ ok: false, message: 'error.worktreeNotFoundForBranch' })
  })
})
