import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createWorktree, removeWorktree } from '#/system/git/worktrees.ts'

const gitResultWithOptionsMock = vi.hoisted(() => vi.fn())

vi.mock('#/system/git/helper.ts', async () => {
  const actual = await vi.importActual<typeof import('#/system/git/helper.ts')>('#/system/git/helper.ts')
  return {
    ...actual,
    gitResultWithOptions: vi.fn((cwd: string, opts: unknown, ...args: string[]) => gitResultWithOptionsMock(cwd, opts, ...args)),
  }
})

describe('worktree git operations', () => {
  beforeEach(() => {
    gitResultWithOptionsMock.mockReset()
    gitResultWithOptionsMock.mockResolvedValue({ ok: false, message: 'cancelled' })
  })

  test('delegates createWorktree to git worktree add with the shared timeout and signal', async () => {
    const signal = new AbortController().signal

    const result = await createWorktree('/tmp/repo', '/tmp/repo-feature', 'feature/branch', 'main', signal)

    expect(result).toEqual({ ok: false, message: 'cancelled' })
    expect(gitResultWithOptionsMock).toHaveBeenCalledWith(
      '/tmp/repo',
      { timeoutMs: 180_000, signal },
      'worktree',
      'add',
      '-b',
      'feature/branch',
      '--',
      '/tmp/repo-feature',
      'main',
    )
  })

  test('delegates removeWorktree to git worktree remove with the shared timeout and signal', async () => {
    const signal = new AbortController().signal

    const result = await removeWorktree('/tmp/repo', '/tmp/repo-feature', signal)

    expect(result).toEqual({ ok: false, message: 'cancelled' })
    expect(gitResultWithOptionsMock).toHaveBeenCalledWith(
      '/tmp/repo',
      { timeoutMs: 180_000, signal },
      'worktree',
      'remove',
      '--',
      '/tmp/repo-feature',
    )
  })
})
