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

  test.each([
    [
      'newBranch',
      {
        worktreePath: '/tmp/repo-feature',
        mode: { kind: 'newBranch' as const, newBranch: 'feature/branch', baseRef: 'main' },
      },
      ['worktree', 'add', '-b', 'feature/branch', '--', '/tmp/repo-feature', 'main'],
    ],
    [
      'existingBranch',
      {
        worktreePath: '/tmp/repo-feature',
        mode: { kind: 'existingBranch' as const, branch: 'feature/branch' },
      },
      ['worktree', 'add', '--', '/tmp/repo-feature', 'feature/branch'],
    ],
    [
      'trackRemoteBranch',
      {
        worktreePath: '/tmp/repo-feature',
        mode: { kind: 'trackRemoteBranch' as const, remoteRef: 'origin/feature/branch', localBranch: 'feature/branch' },
      },
      ['worktree', 'add', '-b', 'feature/branch', '--track', '--', '/tmp/repo-feature', 'origin/feature/branch'],
    ],
    [
      'detached',
      {
        worktreePath: '/tmp/repo-detached',
        mode: { kind: 'detached' as const, ref: 'origin/feature/branch' },
      },
      ['worktree', 'add', '--detach', '--', '/tmp/repo-detached', 'origin/feature/branch'],
    ],
  ])('delegates %s createWorktree to git worktree add with the shared timeout and signal', async (_name, input, expectedArgs) => {
    const signal = new AbortController().signal

    const result = await createWorktree('/tmp/repo', input, signal)

    expect(result).toEqual({ ok: false, message: 'cancelled' })
    expect(gitResultWithOptionsMock).toHaveBeenCalledWith('/tmp/repo', { timeoutMs: 180_000, signal }, ...expectedArgs)
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
