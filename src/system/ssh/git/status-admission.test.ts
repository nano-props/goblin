import { describe, expect, test, vi } from 'vitest'
import { getRemotePatch } from '#/system/ssh/git/patch.ts'
import { getRemoteStatus } from '#/system/ssh/git/status.ts'
import type { RemoteCommandRunner } from '#/system/ssh/commands.ts'
import type { RemoteCommandResult } from '#/system/ssh/commands.ts'
import { NUL, TARGET, failRemoteResult, okRemoteResult } from '#/system/ssh/git/test-utils.ts'

describe('remote Git status admission', () => {
  const worktreeListOutput =
    [
      'worktree /srv/repo',
      'HEAD f00ba40000000000000000000000000000000000',
      'branch refs/heads/main',
      '',
      'worktree /srv/repo-feature',
      'HEAD ba5eba1000000000000000000000000000000000',
      'branch refs/heads/feature/test',
    ].join(NUL) +
    NUL +
    NUL

  test('shares status admission with remote patch enumeration', async () => {
    const oneWorktreeOutput =
      ['worktree /srv/repo', 'HEAD f00ba40000000000000000000000000000000000', 'branch refs/heads/main'].join(NUL) +
      NUL +
      NUL
    const statusCompletions: Array<PromiseWithResolvers<RemoteCommandResult>> = []
    const run = vi.fn<RemoteCommandRunner>(async (command) => {
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
})
