import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createWorktree, getWorktrees, removeWorktree } from '#/system/git/worktrees.ts'

const gitResultWithOptionsMock = vi.hoisted(() => vi.fn())
const gitMock = vi.hoisted(() => vi.fn())

vi.mock('#/system/git/git-exec.ts', async () => {
  const actual = await vi.importActual<typeof import('#/system/git/git-exec.ts')>('#/system/git/git-exec.ts')
  return {
    ...actual,
    git: gitMock,
    gitResultWithOptions: vi.fn((cwd: string, opts: unknown, ...args: string[]) =>
      gitResultWithOptionsMock(cwd, opts, ...args),
    ),
  }
})

describe('worktree git operations', () => {
  beforeEach(() => {
    gitResultWithOptionsMock.mockReset()
    gitResultWithOptionsMock.mockResolvedValue({ ok: false, message: 'cancelled' })
    gitMock.mockReset()
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
        mode: {
          kind: 'trackRemoteBranch' as const,
          remote: {
            ref: 'refs/remotes/origin/feature/branch',
            remote: 'origin',
            branch: 'feature/branch',
          },
          localBranch: 'feature/branch',
        },
      },
      ['worktree', 'add', '-b', 'feature/branch', '--track', '--', '/tmp/repo-feature', 'refs/remotes/origin/feature/branch'],
    ],
  ])(
    'delegates %s createWorktree to git worktree add with the shared timeout and signal',
    async (_name, input, expectedArgs) => {
      const signal = new AbortController().signal

      const result = await createWorktree('/tmp/repo', input, signal)

      expect(result).toEqual({ ok: false, message: 'cancelled' })
      expect(gitResultWithOptionsMock).toHaveBeenCalledWith(
        '/tmp/repo',
        { timeoutMs: 180_000, signal },
        ...expectedArgs,
      )
    },
  )

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

  test('does not turn a failed authoritative worktree-list read into an empty repository', async () => {
    gitMock.mockRejectedValue(new Error('git unavailable'))

    await expect(getWorktrees('/tmp/repo', { includeStatus: false })).rejects.toThrow('git unavailable')
  })
})
