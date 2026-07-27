import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  createWorktree,
  readWorktreeMembership,
  removeWorktree,
  sampleWorktreeStatus,
  sampleWorktreeStatusForTarget,
} from '#/system/git/worktrees.ts'
import type { WorktreeInfo } from '#/shared/git-types.ts'

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

    await expect(readWorktreeMembership('/tmp/repo')).rejects.toThrow('git unavailable')
  })

  test('bounds status probes across concurrent aggregate callers', async () => {
    let active = 0
    let peak = 0
    const releases: Array<() => void> = []
    gitMock.mockImplementation(
      async () =>
        await new Promise<string>((resolve) => {
          active += 1
          peak = Math.max(peak, active)
          releases.push(() => {
            active -= 1
            resolve('')
          })
        }),
    )
    const first = sampleWorktreeStatus(Array.from({ length: 6 }, (_, index) => worktree(`a-${index}`)))
    const second = sampleWorktreeStatus(Array.from({ length: 6 }, (_, index) => worktree(`b-${index}`)))

    let released = 0
    while (released < 12) {
      await vi.waitFor(() => expect(releases.length).toBeGreaterThan(released))
      const ready = releases.slice(released)
      released += ready.length
      for (const release of ready) release()
    }
    await Promise.all([first, second])

    expect(peak).toBe(4)
  })

  test('does not start a queued status probe after caller cancellation', async () => {
    const releases: Array<() => void> = []
    gitMock.mockImplementation(
      async () =>
        await new Promise<string>((resolve) => {
          releases.push(() => resolve(''))
        }),
    )
    const blockers = Array.from({ length: 4 }, (_, index) => sampleWorktreeStatusForTarget(worktree(`busy-${index}`)))
    await vi.waitFor(() => expect(gitMock).toHaveBeenCalledTimes(4))
    const controller = new AbortController()
    const queued = sampleWorktreeStatusForTarget(worktree('queued'), controller.signal)

    controller.abort()
    await expect(queued).rejects.toMatchObject({ name: 'AbortError' })
    expect(gitMock).toHaveBeenCalledTimes(4)

    for (const release of releases) release()
    await Promise.all(blockers)
  })

  test('passes caller cancellation to a running status probe', async () => {
    const controller = new AbortController()
    let receivedSignal: AbortSignal | undefined
    gitMock.mockImplementation(
      async (_cwd: string, _args: string[], options?: { signal?: AbortSignal }) =>
        await new Promise<string>((_resolve, reject) => {
          receivedSignal = options?.signal
          options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true })
        }),
    )
    const running = sampleWorktreeStatusForTarget(worktree('running'), controller.signal)
    await vi.waitFor(() => expect(receivedSignal).toBe(controller.signal))

    controller.abort(new Error('cancelled by caller'))

    await expect(running).rejects.toThrow('cancelled by caller')
  })

  test('keeps a cancelled running probe admitted until the Git task settles', async () => {
    const controller = new AbortController()
    const completions: Array<PromiseWithResolvers<string>> = []
    gitMock.mockImplementation(async () => {
      const completion = Promise.withResolvers<string>()
      completions.push(completion)
      return await completion.promise
    })
    const first = sampleWorktreeStatusForTarget(worktree('running-0'), controller.signal)
    const blockers = Array.from({ length: 3 }, (_, index) =>
      sampleWorktreeStatusForTarget(worktree(`running-${index + 1}`)),
    )
    await vi.waitFor(() => expect(gitMock).toHaveBeenCalledTimes(4))

    controller.abort(new Error('cancelled while Git exits'))
    const fifth = sampleWorktreeStatusForTarget(worktree('fifth'))
    await Promise.resolve()
    expect(gitMock).toHaveBeenCalledTimes(4)

    completions[0]!.resolve('')
    await expect(first).rejects.toThrow('cancelled while Git exits')
    await vi.waitFor(() => expect(gitMock).toHaveBeenCalledTimes(5))
    for (const completion of completions.slice(1)) completion.resolve('')
    await Promise.all([...blockers, fifth])
  })

  test('rejects an already-aborted bare target before returning a sample', async () => {
    const controller = new AbortController()
    controller.abort(new Error('already cancelled'))

    await expect(sampleWorktreeStatusForTarget({ ...worktree('bare'), isBare: true }, controller.signal)).rejects.toThrow(
      'already cancelled',
    )
    expect(gitMock).not.toHaveBeenCalled()
  })
})

function worktree(name: string): WorktreeInfo {
  return {
    path: `/tmp/${name}`,
    branch: `feature/${name}`,
    isBare: false,
    isPrimary: false,
  }
}
