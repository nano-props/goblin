import { describe, expect, test } from 'vitest'
import { resolveKnownWorktree, resolveRemovableWorktree } from '#/shared/worktree-guards.ts'

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
    expect(result).toEqual({ ok: false, message: 'error.invalid-worktree-path' })
  })
})

describe('resolveRemovableWorktree', () => {
  const repoRoot = '/repo'
  const main = { path: '/repo', branch: 'main', isBare: false, isPrimary: true }
  const linked = { path: '/repo-linked', branch: 'feature', isBare: false, isPrimary: false }

  test('resolves a non-primary worktree', () => {
    const result = resolveRemovableWorktree([main, linked], '/repo-linked', repoRoot)
    expect(result).toEqual({ ok: true, target: linked })
  })

  test('refuses the primary worktree by isPrimary flag', () => {
    const result = resolveRemovableWorktree([main, linked], '/repo', repoRoot)
    expect(result).toEqual({ ok: false, message: 'error.cannot-remove-main-worktree' })
  })

  test('refuses when path resolves to the repo root even if isPrimary missed it', () => {
    // Defensive: parser should always set isPrimary for the first entry,
    // but if it didn't, the repo-root path check still catches it.
    const odd = { path: '/repo', branch: 'main', isBare: false, isPrimary: false }
    const result = resolveRemovableWorktree([odd], '/repo', repoRoot)
    expect(result).toEqual({ ok: false, message: 'error.cannot-remove-main-worktree' })
  })

  test('rejects an unknown worktree path', () => {
    const result = resolveRemovableWorktree([linked], '/somewhere/else', repoRoot)
    expect(result).toEqual({ ok: false, message: 'error.worktree-not-found' })
  })
})
