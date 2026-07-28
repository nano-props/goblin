import { beforeEach, describe, expect, test, vi } from 'vitest'
import { getWorktreePatch } from '#/system/git/patch.ts'
import { sampleWorktreeStatus, sampleWorktreeStatusForTarget } from '#/system/git/status.ts'
import type { WorktreeInfo } from '#/shared/git-types.ts'

const mocks = vi.hoisted(() => ({ git: vi.fn() }))

vi.mock('#/system/git/git-exec.ts', () => ({ git: mocks.git }))

beforeEach(() => {
  mocks.git.mockReset()
})

describe('getWorkingStatus', () => {
  test('rejects when the worktree list cannot be read', async () => {
    mocks.git.mockRejectedValueOnce(new Error('worktree list failed'))
    const { getWorkingStatus } = await import('#/system/git/status.ts')

    await expect(getWorkingStatus('/tmp/repo')).rejects.toThrow('worktree list failed')
  })

  test('rejects the complete read when one non-bare worktree status fails', async () => {
    mocks.git
      .mockResolvedValueOnce(
        [
          'worktree /tmp/repo',
          'HEAD f00ba4a',
          'branch refs/heads/main',
          '',
          'worktree /tmp/worktree-a',
          'HEAD ba5eba1',
          'branch refs/heads/feature/a',
        ].join('\0') + '\0\0',
      )
      .mockResolvedValueOnce('')
      .mockRejectedValueOnce(new Error('status failed'))
    const { getWorkingStatus } = await import('#/system/git/status.ts')

    await expect(getWorkingStatus('/tmp/repo')).rejects.toThrow('status failed')
  })

  test('rejects when a listed worktree disappears during status sampling', async () => {
    mocks.git
      .mockResolvedValueOnce(
        [
          'worktree /tmp/repo',
          'HEAD f00ba4a',
          'branch refs/heads/main',
          '',
          'worktree /tmp/worktree-a',
          'HEAD ba5eba1',
          'branch refs/heads/feature/a',
        ].join('\0') + '\0\0',
      )
      .mockResolvedValueOnce('')
      .mockRejectedValueOnce(new Error('cwd disappeared'))
    const { getWorkingStatus } = await import('#/system/git/status.ts')

    await expect(getWorkingStatus('/tmp/repo')).rejects.toThrow('cwd disappeared')
  })

  test('does not run status for a prunable worktree with a missing path', async () => {
    mocks.git
      .mockResolvedValueOnce(
        [
          'worktree /tmp/repo',
          'HEAD f00ba4a',
          'branch refs/heads/main',
          '',
          'worktree /tmp/missing-worktree',
          'HEAD ba5eba1',
          'branch refs/heads/stale',
          'prunable gitdir file points to non-existent location',
        ].join('\0') + '\0\0',
      )
      .mockResolvedValueOnce('')
    const { getWorkingStatus } = await import('#/system/git/status.ts')

    await expect(getWorkingStatus('/tmp/repo')).resolves.toEqual([
      { path: '/tmp/repo', branch: 'main', isMain: true, entries: [] },
    ])
    expect(mocks.git).toHaveBeenCalledTimes(2)
  })

  test('returns complete status for branch and detached worktrees', async () => {
    const membership =
      [
        'worktree /tmp/repo',
        'HEAD f00ba4a',
        'branch refs/heads/main',
        '',
        'worktree /tmp/detached-worktree',
        'HEAD ba5eba1',
        'detached',
      ].join('\0') + '\0\0'
    mocks.git.mockResolvedValueOnce(membership).mockResolvedValueOnce('').mockResolvedValueOnce('?? detached.ts\0')
    const { getWorkingStatus } = await import('#/system/git/status.ts')

    await expect(getWorkingStatus('/tmp/repo')).resolves.toEqual([
      { path: '/tmp/repo', branch: 'main', isMain: true, entries: [] },
      {
        path: '/tmp/detached-worktree',
        branch: undefined,
        isMain: false,
        entries: [{ x: '?', y: '?', path: 'detached.ts' }],
      },
    ])
    expect(mocks.git).toHaveBeenCalledTimes(3)
  })

  test('rejects when the signal aborts before a command result is accepted', async () => {
    const controller = new AbortController()
    mocks.git.mockImplementationOnce(async () => {
      controller.abort(new Error('status deadline'))
      return 'worktree /tmp/repo\nHEAD f00ba4a\nbranch refs/heads/main'
    })
    const { getWorkingStatus } = await import('#/system/git/status.ts')

    await expect(getWorkingStatus('/tmp/repo', { signal: controller.signal })).rejects.toThrow('status deadline')
  })

  test('bounds status probes across concurrent aggregate callers', async () => {
    let active = 0
    let peak = 0
    const releases: Array<() => void> = []
    mocks.git.mockImplementation(
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

  test('shares status admission with patch untracked-file enumeration', async () => {
    const statusCompletions: Array<PromiseWithResolvers<string>> = []
    mocks.git.mockImplementation(async (_cwd: string, args: string[]) => {
      if (args[0] === 'diff') return ''
      if (args[0] !== 'status') throw new Error(`unexpected git command: ${args.join(' ')}`)
      const completion = Promise.withResolvers<string>()
      statusCompletions.push(completion)
      return await completion.promise
    })
    const blockers = Array.from({ length: 4 }, (_, index) => sampleWorktreeStatusForTarget(worktree(`busy-${index}`)))
    await vi.waitFor(() => expect(statusCompletions).toHaveLength(4))

    const patch = getWorktreePatch('/tmp/patch-worktree')
    await vi.waitFor(() =>
      expect(mocks.git).toHaveBeenCalledWith('/tmp/patch-worktree', ['diff', 'HEAD', '--binary'], {
        signal: undefined,
      }),
    )
    expect(mocks.git.mock.calls.some(([, args]) => args.includes('-uall'))).toBe(false)

    statusCompletions[0]!.resolve('')
    await vi.waitFor(() => expect(statusCompletions).toHaveLength(5))
    expect(mocks.git.mock.calls.some(([, args]) => args.includes('-uall'))).toBe(true)
    for (const completion of statusCompletions.slice(1)) completion.resolve('')
    await Promise.all([...blockers, patch])
  })

  test('stops submitting aggregate probes after the first failure', async () => {
    const running = Promise.withResolvers<string>()
    const runningWorkersSettled = Promise.withResolvers<void>()
    let started = 0
    let unsettledRunningWorkers = 3
    mocks.git.mockImplementation(async () => {
      started += 1
      if (started === 1) throw new Error('status failed')
      try {
        return await running.promise
      } finally {
        if (unsettledRunningWorkers > 0) {
          unsettledRunningWorkers -= 1
          if (unsettledRunningWorkers === 0) runningWorkersSettled.resolve()
        }
      }
    })

    const read = sampleWorktreeStatus(Array.from({ length: 20 }, (_, index) => worktree(`failure-${index}`)))
    await expect(read).rejects.toThrow('status failed')
    expect(started).toBe(4)

    running.resolve('')
    await runningWorkersSettled.promise
    expect(started).toBe(4)

    await expect(sampleWorktreeStatusForTarget(worktree('after-failure'))).resolves.toMatchObject({ kind: 'status' })
    expect(started).toBe(5)
  })

  test('does not start a queued status probe after caller cancellation', async () => {
    const releases: Array<() => void> = []
    mocks.git.mockImplementation(
      async () =>
        await new Promise<string>((resolve) => {
          releases.push(() => resolve(''))
        }),
    )
    const blockers = Array.from({ length: 4 }, (_, index) => sampleWorktreeStatusForTarget(worktree(`busy-${index}`)))
    await vi.waitFor(() => expect(mocks.git).toHaveBeenCalledTimes(4))
    const controller = new AbortController()
    const queued = sampleWorktreeStatusForTarget(worktree('queued'), controller.signal)

    controller.abort()
    await expect(queued).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.git).toHaveBeenCalledTimes(4)

    for (const release of releases) release()
    await Promise.all(blockers)
  })

  test('passes caller cancellation to a running status probe', async () => {
    const controller = new AbortController()
    let receivedSignal: AbortSignal | undefined
    mocks.git.mockImplementation(
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
    mocks.git.mockImplementation(async () => {
      const completion = Promise.withResolvers<string>()
      completions.push(completion)
      return await completion.promise
    })
    const first = sampleWorktreeStatusForTarget(worktree('running-0'), controller.signal)
    const blockers = Array.from({ length: 3 }, (_, index) =>
      sampleWorktreeStatusForTarget(worktree(`running-${index + 1}`)),
    )
    await vi.waitFor(() => expect(mocks.git).toHaveBeenCalledTimes(4))

    controller.abort(new Error('cancelled while Git exits'))
    const fifth = sampleWorktreeStatusForTarget(worktree('fifth'))
    await Promise.resolve()
    expect(mocks.git).toHaveBeenCalledTimes(4)

    completions[0]!.resolve('')
    await expect(first).rejects.toThrow('cancelled while Git exits')
    await vi.waitFor(() => expect(mocks.git).toHaveBeenCalledTimes(5))
    for (const completion of completions.slice(1)) completion.resolve('')
    await Promise.all([...blockers, fifth])
  })

  test('rejects an already-aborted bare target before returning a sample', async () => {
    const controller = new AbortController()
    controller.abort(new Error('already cancelled'))

    await expect(
      sampleWorktreeStatusForTarget({ ...worktree('bare'), isBare: true }, controller.signal),
    ).rejects.toThrow('already cancelled')
    expect(mocks.git).not.toHaveBeenCalled()
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
