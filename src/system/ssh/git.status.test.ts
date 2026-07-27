import { describe, expect, test, vi } from 'vitest'
import { getRemotePatch, getRemoteStatus, type RemoteGitRunner } from '#/system/ssh/git.ts'
import type { RemoteCommandResult } from '#/system/ssh/commands.ts'
import { NUL, TARGET, failRemoteResult, okRemoteResult } from '#/system/ssh/git-test-utils.ts'

describe('remote Git status and patch admission', () => {
  const worktreeListOutput =
    [
      'worktree /srv/repo',
      'HEAD f00ba40',
      'branch refs/heads/main',
      '',
      'worktree /srv/repo-feature',
      'HEAD ba5eba1',
      'branch refs/heads/feature/test',
    ].join(NUL) +
    NUL +
    NUL

  test('returns complete status from one authoritative membership read', async () => {
    const detachedOutput =
      [
        'worktree /srv/repo',
        'HEAD f00ba40',
        'branch refs/heads/main',
        '',
        'worktree /srv/repo-detached',
        'HEAD ba5eba1',
        'detached',
      ].join(NUL) +
      NUL +
      NUL
    const run = vi.fn<RemoteGitRunner>(async (command) => {
      if (command.type === 'gitWorktreeList') return okRemoteResult(detachedOutput)
      if (command.type === 'gitStatus' && command.path === '/srv/repo') {
        return okRemoteResult(`M  README.md${NUL}`)
      }
      if (command.type === 'gitStatus' && command.path === '/srv/repo-detached') {
        return okRemoteResult(`?? detached.ts${NUL}`)
      }
      return failRemoteResult('unexpected command')
    })

    await expect(getRemoteStatus(TARGET, { run })).resolves.toEqual([
      {
        path: '/srv/repo',
        branch: 'main',
        isMain: true,
        entries: [{ x: 'M', y: ' ', path: 'README.md' }],
      },
      {
        path: '/srv/repo-detached',
        branch: undefined,
        isMain: false,
        entries: [{ x: '?', y: '?', path: 'detached.ts' }],
      },
    ])
    expect(run.mock.calls.filter(([command]) => command.type === 'gitWorktreeList')).toHaveLength(1)
  })

  test('bounds status probes across concurrent aggregate callers', async () => {
    const statusBarrier = Promise.withResolvers<void>()
    let activeStatusReads = 0
    let peakStatusReads = 0
    const run = vi.fn<RemoteGitRunner>(async (command) => {
      if (command.type === 'gitWorktreeList') return okRemoteResult(worktreeListOutput)
      if (command.type !== 'gitStatus') return failRemoteResult('unexpected command')
      activeStatusReads += 1
      peakStatusReads = Math.max(peakStatusReads, activeStatusReads)
      await statusBarrier.promise
      activeStatusReads -= 1
      return okRemoteResult('')
    })

    const reads = [getRemoteStatus(TARGET, { run }), getRemoteStatus(TARGET, { run }), getRemoteStatus(TARGET, { run })]
    await vi.waitFor(() => expect(activeStatusReads).toBe(4))
    expect(peakStatusReads).toBe(4)
    statusBarrier.resolve()
    await Promise.all(reads)
    expect(peakStatusReads).toBe(4)
  })

  test('shares status admission with remote patch enumeration', async () => {
    const oneWorktreeOutput = ['worktree /srv/repo', 'HEAD f00ba40', 'branch refs/heads/main'].join(NUL) + NUL + NUL
    const statusCompletions: Array<PromiseWithResolvers<RemoteCommandResult>> = []
    const run = vi.fn<RemoteGitRunner>(async (command) => {
      if (command.type === 'gitWorktreeList') return okRemoteResult(oneWorktreeOutput)
      if (command.type === 'gitPatch') return okRemoteResult('')
      if (command.type === 'gitStatus' || command.type === 'gitStatusAll') {
        const completion = Promise.withResolvers<RemoteCommandResult>()
        statusCompletions.push(completion)
        return await completion.promise
      }
      return failRemoteResult('unexpected command')
    })
    const blockers = Array.from({ length: 4 }, () => getRemoteStatus(TARGET, { run }))
    await vi.waitFor(() => expect(statusCompletions).toHaveLength(4))

    const patch = getRemotePatch(TARGET, '/srv/repo', {
      run,
      knownWorktrees: [{ path: '/srv/repo', branch: 'main', isBare: false, isPrimary: true }],
    })
    await vi.waitFor(() => expect(run.mock.calls.some(([command]) => command.type === 'gitPatch')).toBe(true))
    expect(run.mock.calls.some(([command]) => command.type === 'gitStatusAll')).toBe(false)

    statusCompletions[0]!.resolve(okRemoteResult(''))
    await vi.waitFor(() => expect(statusCompletions).toHaveLength(5))
    expect(run.mock.calls.some(([command]) => command.type === 'gitStatusAll')).toBe(true)
    for (const completion of statusCompletions.slice(1)) completion.resolve(okRemoteResult(''))
    await Promise.all([...blockers, patch])
  })

  test('stops submitting aggregate probes after the first failure', async () => {
    const worktrees =
      Array.from({ length: 20 }, (_, index) =>
        [
          `worktree /srv/repo-${index}`,
          `HEAD ${String(index).padStart(7, '0')}`,
          `branch refs/heads/feature/${index}`,
        ].join(NUL),
      ).join(NUL + NUL) +
      NUL +
      NUL
    const running = Promise.withResolvers<RemoteCommandResult>()
    const runningWorkersSettled = Promise.withResolvers<void>()
    let started = 0
    let unsettledRunningWorkers = 3
    const run = vi.fn<RemoteGitRunner>(async (command) => {
      if (command.type === 'gitWorktreeList') return okRemoteResult(worktrees)
      if (command.type !== 'gitStatus') return failRemoteResult('unexpected command')
      started += 1
      if (started === 1) return failRemoteResult('status failed')
      try {
        return await running.promise
      } finally {
        unsettledRunningWorkers -= 1
        if (unsettledRunningWorkers === 0) runningWorkersSettled.resolve()
      }
    })

    await expect(getRemoteStatus(TARGET, { run })).rejects.toThrow('status failed')
    expect(started).toBe(4)
    running.resolve(okRemoteResult(''))
    await runningWorkersSettled.promise
    expect(started).toBe(4)
  })

  test('cancels a queued status probe without starting it', async () => {
    const statusBarrier = Promise.withResolvers<void>()
    let startedStatusReads = 0
    let membershipReads = 0
    const run = vi.fn<RemoteGitRunner>(async (command) => {
      if (command.type === 'gitWorktreeList') {
        membershipReads += 1
        return okRemoteResult(worktreeListOutput)
      }
      if (command.type !== 'gitStatus') return failRemoteResult('unexpected command')
      startedStatusReads += 1
      await statusBarrier.promise
      return okRemoteResult('')
    })
    const activeReads = Array.from({ length: 2 }, () => getRemoteStatus(TARGET, { run }))
    await vi.waitFor(() => expect(startedStatusReads).toBe(4))
    const controller = new AbortController()
    const queuedRead = getRemoteStatus(TARGET, { run, signal: controller.signal })
    await vi.waitFor(() => expect(membershipReads).toBe(3))
    controller.abort()

    await expect(queuedRead).rejects.toThrow()
    expect(startedStatusReads).toBe(4)
    statusBarrier.resolve()
    await Promise.all(activeReads)
  })

  test('passes caller cancellation to a running status probe', async () => {
    const controller = new AbortController()
    let receivedSignal: AbortSignal | undefined
    const run = vi.fn<RemoteGitRunner>(async (command, _target, options) => {
      if (command.type === 'gitWorktreeList') return okRemoteResult(worktreeListOutput)
      if (command.type !== 'gitStatus') return failRemoteResult('unexpected command')
      return await new Promise<RemoteCommandResult>((_resolve, reject) => {
        receivedSignal = options?.signal
        options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true })
      })
    })
    const read = getRemoteStatus(TARGET, { run, signal: controller.signal })
    await vi.waitFor(() => expect(receivedSignal).toBe(controller.signal))

    controller.abort(new Error('remote status cancelled'))

    await expect(read).rejects.toThrow('remote status cancelled')
  })

  test('keeps a cancelled running probe admitted until the SSH task settles', async () => {
    const oneWorktreeOutput = ['worktree /srv/repo', 'HEAD f00ba40', 'branch refs/heads/main'].join(NUL) + NUL + NUL
    const controller = new AbortController()
    const completions: Array<PromiseWithResolvers<RemoteCommandResult>> = []
    let startedStatusReads = 0
    const run = vi.fn<RemoteGitRunner>(async (command) => {
      if (command.type === 'gitWorktreeList') return okRemoteResult(oneWorktreeOutput)
      if (command.type !== 'gitStatus') return failRemoteResult('unexpected command')
      startedStatusReads += 1
      const completion = Promise.withResolvers<RemoteCommandResult>()
      completions.push(completion)
      return await completion.promise
    })
    const first = getRemoteStatus(TARGET, { run, signal: controller.signal })
    const blockers = Array.from({ length: 3 }, () => getRemoteStatus(TARGET, { run }))
    await vi.waitFor(() => expect(startedStatusReads).toBe(4))

    controller.abort(new Error('cancelled while SSH exits'))
    const fifth = getRemoteStatus(TARGET, { run })
    await Promise.resolve()
    expect(startedStatusReads).toBe(4)

    completions[0]!.resolve(okRemoteResult(''))
    await expect(first).rejects.toThrow('cancelled while SSH exits')
    await vi.waitFor(() => expect(startedStatusReads).toBe(5))
    for (const completion of completions.slice(1)) completion.resolve(okRemoteResult(''))
    await Promise.all([...blockers, fifth])
  })

  test('stops submitting untracked patch reads after the first failure', async () => {
    const untrackedStatus = Array.from({ length: 20 }, (_, index) => `?? file-${index}.ts${NUL}`).join('')
    const running = Promise.withResolvers<RemoteCommandResult>()
    const runningWorkersSettled = Promise.withResolvers<void>()
    let started = 0
    let unsettledRunningWorkers = 7
    const run = vi.fn<RemoteGitRunner>(async (command) => {
      if (command.type === 'gitPatch') return okRemoteResult('')
      if (command.type === 'gitStatusAll') return okRemoteResult(untrackedStatus)
      if (command.type !== 'gitDiffNoIndex') return failRemoteResult('unexpected command')
      started += 1
      if (started === 1) return failRemoteResult('patch failed')
      try {
        return await running.promise
      } finally {
        unsettledRunningWorkers -= 1
        if (unsettledRunningWorkers === 0) runningWorkersSettled.resolve()
      }
    })

    const patch = getRemotePatch(TARGET, '/srv/repo', {
      run,
      knownWorktrees: [{ path: '/srv/repo', branch: 'main', isBare: false, isPrimary: true }],
    })

    await expect(patch).resolves.toEqual({ ok: false, message: 'patch failed' })
    expect(started).toBe(8)

    running.resolve(okRemoteResult(''))
    await runningWorkersSettled.promise
    expect(started).toBe(8)
  })
})
