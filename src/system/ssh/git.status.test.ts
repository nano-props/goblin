import { describe, expect, test, vi } from 'vitest'
import { getRemotePatch, type RemoteGitRunner } from '#/system/ssh/git.ts'
import type { RemoteCommandResult } from '#/system/ssh/commands.ts'
import { NUL, TARGET, failRemoteResult, okRemoteResult } from '#/system/ssh/git-test-utils.ts'

describe('remote Git status and patch admission', () => {
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
