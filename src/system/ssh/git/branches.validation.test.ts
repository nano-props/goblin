import { describe, expect, test, vi } from 'vitest'
import { deleteRemoteBranch, getRemoteLog } from '#/system/ssh/git/branches.ts'
import type { RemoteCommandRunner } from '#/system/ssh/commands.ts'
import { TARGET, okRemoteResult } from '#/system/ssh/git/test-utils.ts'

describe('remote Git branch input validation', () => {
  test('getRemoteLog rejects unsafe branch names before running remote commands', async () => {
    const run = vi.fn<RemoteCommandRunner>()

    const entries = await getRemoteLog(TARGET, { kind: 'branch', branchName: '../feature' }, undefined, undefined, {
      run: run,
    })

    expect(entries).toEqual([])
    expect(run).not.toHaveBeenCalled()
  })

  test.each([
    { target: { kind: 'branch' as const, branchName: 'feature/history' }, revision: 'refs/heads/feature/history' },
    {
      target: { kind: 'commit' as const, oid: '2222222222222222222222222222222222222222' },
      revision: '2222222222222222222222222222222222222222',
    },
  ])('resolves a $target.kind log target only at the remote command boundary', async ({ target, revision }) => {
    const run = vi.fn<RemoteCommandRunner>(async () => okRemoteResult(''))

    await expect(getRemoteLog(TARGET, target, 20, 5, { run })).resolves.toEqual([])

    expect(run).toHaveBeenCalledWith(
      { type: 'gitLog', path: TARGET.remotePath, revision, count: 20, skip: 5 },
      TARGET,
      { signal: undefined },
    )
  })

  test('deleteRemoteBranch rejects unsafe branch names before running remote commands', async () => {
    const run = vi.fn<RemoteCommandRunner>()

    const result = await deleteRemoteBranch(TARGET, { branch: '../feature', run: run })

    expect(result).toEqual({ ok: false, message: 'error.invalid-arguments', branchEffect: 'none' })
    expect(run).not.toHaveBeenCalled()
  })
})
