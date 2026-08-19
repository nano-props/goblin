import { describe, expect, test, vi } from 'vitest'
import { getRemoteBrowserUrl } from '#/system/ssh/git/remote.ts'
import type { RemoteCommandRunner } from '#/system/ssh/commands.ts'
import { TARGET, okRemoteResult, upstreamOutput } from '#/system/ssh/git/test-utils.ts'

describe('remote Git browser URL', () => {
  test('builds browser URLs from remote verbose output', async () => {
    const run: RemoteCommandRunner = async (command) => {
      switch (command.type) {
        case 'gitRemotes':
          return okRemoteResult(
            'origin\tgit@github.com:acme/project.git\tgit@github.com:acme/project.git',
          )
        case 'gitOperationState':
          return okRemoteResult('operation none\nmaterialized-branch\n')
        case 'gitUpstream':
          return okRemoteResult(upstreamOutput('origin', 'feature/test'))
        default:
          return okRemoteResult('')
      }
    }

    await expect(getRemoteBrowserUrl(TARGET, { type: 'root' }, { run: run })).resolves.toBe(
      'https://github.com/acme/project',
    )
    await expect(getRemoteBrowserUrl(TARGET, { type: 'branch', branch: 'feature/test' }, { run: run })).resolves.toBe(
      'https://github.com/acme/project/tree/feature/test',
    )
    await expect(getRemoteBrowserUrl(TARGET, { type: 'commit', hash: 'abcdef1' }, { run: run })).resolves.toBe(
      'https://github.com/acme/project/commit/abcdef1',
    )
  })

  test('getRemoteBrowserUrl rejects unsafe URL targets before running remote commands', async () => {
    const run = vi.fn<RemoteCommandRunner>(async () => okRemoteResult(''))

    await expect(
      getRemoteBrowserUrl(TARGET, { type: 'branch', branch: 'feature/test;echo bad' }, { run: run }),
    ).resolves.toBeNull()
    await expect(getRemoteBrowserUrl(TARGET, { type: 'commit', hash: 'not-a-hash' }, { run: run })).resolves.toBeNull()

    expect(run).not.toHaveBeenCalled()
  })
})
