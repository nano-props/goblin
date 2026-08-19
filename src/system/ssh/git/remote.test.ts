import { describe, expect, test, vi } from 'vitest'
import { commandOutcomeForTest } from '#/test-utils/command-outcome.ts'
import { getRemoteTrackingBranches, fetchRemoteRepo, pushRemoteBranch } from '#/system/ssh/git/remote.ts'
import type { RemoteCommandRunner } from '#/system/ssh/commands.ts'
import {
  MAIN_EMPTY_BRANCHES_SNAPSHOT_OUTPUT,
  NUL,
  TARGET,
  failRemoteResult,
  okRemoteResult,
  upstreamOutput,
} from '#/system/ssh/git/test-utils.ts'

describe('remote Git repository network operations', () => {
  test('pushRemoteBranch prefers the configured upstream remote and branch', async () => {
    const run = vi.fn<RemoteCommandRunner>(async (command: { type: string }) => {
      switch (command.type) {
        case 'gitRemotes':
          return okRemoteResult(
            [
              'origin\tgit@github.com:acme/project.git\tgit@github.com:acme/project.git',
              'fork\tgit@github.com:alice/project.git\tgit@github.com:alice/project.git',
            ].join('\n'),
          )
        case 'gitUpstream':
          return okRemoteResult(upstreamOutput('fork', 'topic/feature-test'))
        case 'gitPush':
          return okRemoteResult('pushed')
        default:
          return okRemoteResult('')
      }
    })

    const result = await pushRemoteBranch(TARGET, 'feature/test', { run: run })

    expect(result).toEqual(commandOutcomeForTest({ ok: true, message: 'pushed' }))
    expect(run).toHaveBeenCalledWith(
      {
        type: 'gitPush',
        path: '/srv/repo',
        remote: 'fork',
        branch: 'feature/test',
        targetBranch: 'topic/feature-test',
        setUpstream: false,
      },
      TARGET,
      { signal: undefined, timeoutMs: 180_000 },
    )
  })

  test('pushRemoteBranch falls back to origin and sets upstream when no upstream is configured', async () => {
    const run = vi.fn<RemoteCommandRunner>(async (command: { type: string }) => {
      switch (command.type) {
        case 'gitRemotes':
          return okRemoteResult(
            'origin\tgit@github.com:acme/project.git\tgit@github.com:acme/project.git',
          )
        case 'gitUpstream':
          return okRemoteResult(NUL.repeat(3))
        case 'gitPush':
          return okRemoteResult('pushed')
        default:
          return okRemoteResult('')
      }
    })

    const result = await pushRemoteBranch(TARGET, 'feature/test', { run: run })

    expect(result).toEqual(commandOutcomeForTest({ ok: true, message: 'pushed' }))
    expect(run).toHaveBeenCalledWith(
      {
        type: 'gitPush',
        path: '/srv/repo',
        remote: 'origin',
        branch: 'feature/test',
        targetBranch: 'feature/test',
        setUpstream: true,
      },
      TARGET,
      { signal: undefined, timeoutMs: 180_000 },
    )
  })

  test('fetchRemoteRepo prefers the current branch upstream remote over fetch --all', async () => {
    const run = vi.fn<RemoteCommandRunner>(async (command: { type: string; remote?: string; branch?: string }) => {
      switch (command.type) {
        case 'gitSnapshot':
          return okRemoteResult(
            [
              '__GOBLIN_REMOTE_CURRENT__',
              'value feature/test',
              '__GOBLIN_REMOTE_DEFAULT__',
              'value main',
              '__GOBLIN_REMOTE_BRANCHES__',
              '',
            ].join('\n'),
          )
        case 'gitRemotes':
          return okRemoteResult(
            [
              'origin\tgit@github.com:acme/project.git\tgit@github.com:acme/project.git',
              'fork\tgit@github.com:alice/project.git\tgit@github.com:alice/project.git',
            ].join('\n'),
          )
        case 'gitUpstream':
          return okRemoteResult(upstreamOutput('fork', 'feature/test'))
        case 'gitFetchRemote':
          return okRemoteResult(`fetched ${command.remote}`)
        default:
          return okRemoteResult('')
      }
    })

    const result = await fetchRemoteRepo(TARGET, { run: run })

    expect(result).toEqual({ result: { ok: true, message: 'fetched fork' }, execution: { status: 'succeeded' } })
    expect(run).toHaveBeenCalledWith({ type: 'gitFetchRemote', path: '/srv/repo', remote: 'fork' }, TARGET, {
      signal: undefined,
      timeoutMs: 180_000,
    })
  })

  test.each(['gitSnapshot', 'gitRemotes', 'gitUpstream'] as const)(
    'fetchRemoteRepo rejects when authoritative %s discovery fails',
    async (failedCommand) => {
      const run = vi.fn<RemoteCommandRunner>(async (command) => {
        if (command.type === failedCommand) return failRemoteResult(`${failedCommand} failed`)
        if (command.type === 'gitSnapshot') {
          return okRemoteResult(MAIN_EMPTY_BRANCHES_SNAPSHOT_OUTPUT)
        }
        if (command.type === 'gitRemotes') {
          return okRemoteResult(
            'origin\tgit@example.test:project.git\tgit@example.test:project.git',
          )
        }
        return okRemoteResult('')
      })

      await expect(fetchRemoteRepo(TARGET, { run })).rejects.toThrow(`${failedCommand} failed`)
      expect(run).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'gitFetchRemote' }),
        TARGET,
        expect.anything(),
      )
    },
  )

  test.each([
    '__GOBLIN_REMOTE_CURRENT__\nvalue main\nunexpected\n__GOBLIN_REMOTE_DEFAULT__\nvalue main\n__GOBLIN_REMOTE_BRANCHES__\n',
    '__GOBLIN_REMOTE_CURRENT__\nvalue invalid branch\n__GOBLIN_REMOTE_DEFAULT__\nvalue main\n__GOBLIN_REMOTE_BRANCHES__\n',
  ])('fetchRemoteRepo rejects malformed current-branch authority', async (snapshotOutput) => {
    const run = vi.fn<RemoteCommandRunner>(async (command) =>
      command.type === 'gitSnapshot' ? okRemoteResult(snapshotOutput) : okRemoteResult(''),
    )

    await expect(fetchRemoteRepo(TARGET, { run })).rejects.toThrow('error.failed-read-repo')
  })

  test.each(['origin/main\nunexpected/branch', 'invalid remote/main', 'origin/invalid branch'])(
    'pushRemoteBranch rejects malformed upstream authority',
    async (upstreamOutput) => {
      const run = vi.fn<RemoteCommandRunner>(async (command) => {
        if (command.type === 'gitRemotes') {
          return okRemoteResult(
            'origin\tgit@example.test:project.git\tgit@example.test:project.git',
          )
        }
        return command.type === 'gitUpstream' ? okRemoteResult(upstreamOutput) : okRemoteResult('')
      })

      await expect(pushRemoteBranch(TARGET, 'feature/test', { run })).rejects.toThrow('error.failed-read-repo')
      expect(run).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'gitPush' }), TARGET, expect.anything())
    },
  )

  test('getRemoteTrackingBranches filters */HEAD from valid refs', async () => {
    const run = vi.fn<RemoteCommandRunner>(async (command) => {
      switch (command.type) {
        case 'gitRemotes':
          return okRemoteResult(
            'origin\thttps://example.test/repo.git\thttps://example.test/repo.git',
          )
        case 'gitRemoteFetchSpecs':
          return okRemoteResult('+refs/heads/*:refs/remotes/origin/*')
        case 'gitRemoteBranches':
          return okRemoteResult(
            [
              'refs/remotes/origin/HEAD',
              'refs/remotes/origin/main',
              'refs/remotes/origin/feature/auth',
              'refs/remotes/origin/feature/ui',
            ].join('\n'),
          )
        default:
          throw new Error(`unexpected command: ${command.type}`)
      }
    })
    const refs = await getRemoteTrackingBranches(TARGET, { run })
    expect(run).toHaveBeenCalledWith({ type: 'gitRemoteBranches', path: '/srv/repo' }, TARGET, { signal: undefined })
    expect(refs).toEqual([
      { ref: 'refs/remotes/origin/main', remote: 'origin', branch: 'main' },
      { ref: 'refs/remotes/origin/feature/auth', remote: 'origin', branch: 'feature/auth' },
      { ref: 'refs/remotes/origin/feature/ui', remote: 'origin', branch: 'feature/ui' },
    ])
  })

  test('getRemoteTrackingBranches rejects malformed authoritative output', async () => {
    const run = vi.fn<RemoteCommandRunner>(async (command) =>
      command.type === 'gitRemotes'
        ? okRemoteResult('origin\thttps://example.test/repo.git\thttps://example.test/repo.git')
        : okRemoteResult('refs/remotes/origin/main\ntruncated-ref'),
    )
    await expect(getRemoteTrackingBranches(TARGET, { run })).rejects.toThrow('error.failed-read-repo')
  })

  test('getRemoteTrackingBranches rejects when the remote command fails', async () => {
    const run = vi.fn<RemoteCommandRunner>(async () => ({ ok: false, stdout: '', stderr: 'ssh: connection refused' }))
    await expect(getRemoteTrackingBranches(TARGET, { run })).rejects.toThrow('error.failed-read-repo')
  })
})
