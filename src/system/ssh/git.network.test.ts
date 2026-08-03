import { describe, expect, test, vi } from 'vitest'
import { commandOutcomeForTest } from '#/test-utils/command-outcome.ts'
import {
  deleteRemoteBranch,
  getRemoteTrackingBranches,
  pullRemoteBranch,
  fetchRemoteRepo,
  pushRemoteBranch,
  type RemoteGitRunner,
} from '#/system/ssh/git.ts'
import type { WorktreeInfo } from '#/shared/git-types.ts'
import type { RemoteCommandResult } from '#/system/ssh/commands.ts'
import {
  MAIN_EMPTY_BRANCHES_SNAPSHOT_OUTPUT,
  NUL,
  PRIMARY_WORKTREE_OUTPUT,
  TARGET,
  failRemoteResult,
  okRemoteResult,
  upstreamOutput,
  worktreePorcelain,
} from '#/system/ssh/git-test-utils.ts'

describe('remote git network', () => {
  test('pullRemoteBranch reports missing upstream remote explicitly', async () => {
    const run = vi.fn<RemoteGitRunner>(async (command: { type: string }) => {
      switch (command.type) {
        case 'gitSnapshot':
          return okRemoteResult(MAIN_EMPTY_BRANCHES_SNAPSHOT_OUTPUT)
        case 'gitUpstream':
          return okRemoteResult(upstreamOutput('fork', 'feature/test'))
        case 'gitRemoteVerbose':
          return okRemoteResult(
            'origin\tgit@github.com:acme/project.git (fetch)\norigin\tgit@github.com:acme/project.git (push)',
          )
        case 'gitWorktreeList':
          return okRemoteResult(PRIMARY_WORKTREE_OUTPUT)
        case 'gitStatus':
          return okRemoteResult('')
        default:
          return okRemoteResult('')
      }
    })

    const result = await pullRemoteBranch(TARGET, 'feature/test', undefined, { run: run })

    expect(result).toEqual(commandOutcomeForTest({ ok: false, message: 'error.pull-no-remote' }, 'not-started'))
  })

  test('pullRemoteBranch reports possible filesystem impact when the start marker was not observed', async () => {
    const run = vi.fn<RemoteGitRunner>(async () => failRemoteResult('connection failed'))

    const result = await pullRemoteBranch(TARGET, 'feature/test', '/srv/repo-feature', { run })

    expect(result).toEqual(
      commandOutcomeForTest(
        {
          ok: false,
          message: 'connection failed',
          worktreePathsToInvalidate: ['/srv/repo-feature'],
        },
        'failed',
      ),
    )
  })

  test('pushRemoteBranch prefers the configured upstream remote and branch', async () => {
    const run = vi.fn<RemoteGitRunner>(async (command: { type: string }) => {
      switch (command.type) {
        case 'gitRemoteVerbose':
          return okRemoteResult(
            [
              'origin\tgit@github.com:acme/project.git (fetch)',
              'origin\tgit@github.com:acme/project.git (push)',
              'fork\tgit@github.com:alice/project.git (fetch)',
              'fork\tgit@github.com:alice/project.git (push)',
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
    const run = vi.fn<RemoteGitRunner>(async (command: { type: string }) => {
      switch (command.type) {
        case 'gitRemoteVerbose':
          return okRemoteResult(
            'origin\tgit@github.com:acme/project.git (fetch)\norigin\tgit@github.com:acme/project.git (push)',
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

  test.each(['pullRemoteBranch', 'pushRemoteBranch'] as const)(
    '%s rejects remote discovery failure before mutation',
    async (operationName) => {
      const run = vi.fn<RemoteGitRunner>(async (command) => {
        if (command.type === 'gitSnapshot') {
          return okRemoteResult(MAIN_EMPTY_BRANCHES_SNAPSHOT_OUTPUT)
        }
        if (command.type === 'gitUpstream') return okRemoteResult(upstreamOutput('origin', 'feature/test'))
        if (command.type === 'gitRemoteVerbose') return failRemoteResult('remote discovery failed')
        if (command.type === 'gitWorktreeList') return okRemoteResult(PRIMARY_WORKTREE_OUTPUT)
        return okRemoteResult('')
      })
      const operation =
        operationName === 'pullRemoteBranch'
          ? pullRemoteBranch(TARGET, 'feature/test', undefined, { run })
          : pushRemoteBranch(TARGET, 'feature/test', { run })

      await expect(operation).rejects.toThrow('remote discovery failed')
      expect(run).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: expect.stringMatching(/^git(?:FetchBranch|Push)$/) }),
        TARGET,
        expect.anything(),
      )
    },
  )

  test('fetchRemoteRepo prefers the current branch upstream remote over fetch --all', async () => {
    const run = vi.fn<RemoteGitRunner>(async (command: { type: string; remote?: string; branch?: string }) => {
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
        case 'gitRemoteVerbose':
          return okRemoteResult(
            [
              'origin\tgit@github.com:acme/project.git (fetch)',
              'origin\tgit@github.com:acme/project.git (push)',
              'fork\tgit@github.com:alice/project.git (fetch)',
              'fork\tgit@github.com:alice/project.git (push)',
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

  test.each(['gitSnapshot', 'gitRemoteVerbose', 'gitUpstream'] as const)(
    'fetchRemoteRepo rejects when authoritative %s discovery fails',
    async (failedCommand) => {
      const run = vi.fn<RemoteGitRunner>(async (command) => {
        if (command.type === failedCommand) return failRemoteResult(`${failedCommand} failed`)
        if (command.type === 'gitSnapshot') {
          return okRemoteResult(MAIN_EMPTY_BRANCHES_SNAPSHOT_OUTPUT)
        }
        if (command.type === 'gitRemoteVerbose') {
          return okRemoteResult(
            'origin\tgit@example.test:project.git (fetch)\norigin\tgit@example.test:project.git (push)',
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
    const run = vi.fn<RemoteGitRunner>(async (command) =>
      command.type === 'gitSnapshot' ? okRemoteResult(snapshotOutput) : okRemoteResult(''),
    )

    await expect(fetchRemoteRepo(TARGET, { run })).rejects.toThrow('error.failed-read-repo')
  })

  test.each(['origin/main\nunexpected/branch', 'invalid remote/main', 'origin/invalid branch'])(
    'pushRemoteBranch rejects malformed upstream authority',
    async (upstreamOutput) => {
      const run = vi.fn<RemoteGitRunner>(async (command) => {
        if (command.type === 'gitRemoteVerbose') {
          return okRemoteResult(
            'origin\tgit@example.test:project.git (fetch)\norigin\tgit@example.test:project.git (push)',
          )
        }
        return command.type === 'gitUpstream' ? okRemoteResult(upstreamOutput) : okRemoteResult('')
      })

      await expect(pushRemoteBranch(TARGET, 'feature/test', { run })).rejects.toThrow('error.failed-read-repo')
      expect(run).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'gitPush' }), TARGET, expect.anything())
    },
  )

  test('deleteRemoteBranch rejects merge-fact failure before deleting', async () => {
    const run = vi.fn<RemoteGitRunner>(async (command) => {
      if (command.type === 'gitSnapshot') {
        return okRemoteResult(MAIN_EMPTY_BRANCHES_SNAPSHOT_OUTPUT)
      }
      if (command.type === 'gitWorktreeList') {
        return okRemoteResult(worktreePorcelain('worktree /srv/repo\nHEAD f00ba40\nbranch refs/heads/main'))
      }
      if (command.type === 'gitUpstream') return okRemoteResult(NUL.repeat(3))
      if (command.type === 'gitIsAncestor') return failRemoteResult('merge read failed')
      return okRemoteResult('')
    })

    await expect(deleteRemoteBranch(TARGET, { branch: 'feature/test', run })).rejects.toThrow('merge read failed')
    expect(run).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'gitBranchDelete' }),
      TARGET,
      expect.anything(),
    )
  })

  test('deleteRemoteBranch rejects malformed merge-fact output before deleting', async () => {
    const run = vi.fn<RemoteGitRunner>(async (command) => {
      if (command.type === 'gitSnapshot') {
        return okRemoteResult(MAIN_EMPTY_BRANCHES_SNAPSHOT_OUTPUT)
      }
      if (command.type === 'gitIsAncestor') return okRemoteResult('unknown')
      return okRemoteResult('')
    })

    await expect(deleteRemoteBranch(TARGET, { branch: 'feature/test', run })).rejects.toThrow('error.failed-read-repo')
    expect(run).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'gitBranchDelete' }),
      TARGET,
      expect.anything(),
    )
  })

  test('getRemoteTrackingBranches filters */HEAD from valid refs', async () => {
    const run = vi.fn<RemoteGitRunner>(async (command) => {
      switch (command.type) {
        case 'gitRemoteVerbose':
          return okRemoteResult(
            'origin\thttps://example.test/repo.git (fetch)\norigin\thttps://example.test/repo.git (push)',
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
    const run = vi.fn<RemoteGitRunner>(async (command) =>
      command.type === 'gitRemoteVerbose'
        ? okRemoteResult('origin\thttps://example.test/repo.git (fetch)\norigin\thttps://example.test/repo.git (push)')
        : okRemoteResult('refs/remotes/origin/main\ntruncated-ref'),
    )
    await expect(getRemoteTrackingBranches(TARGET, { run })).rejects.toThrow('error.failed-read-repo')
  })

  test('getRemoteTrackingBranches rejects when the remote command fails', async () => {
    const run = vi.fn<RemoteGitRunner>(async () => ({ ok: false, stdout: '', stderr: 'ssh: connection refused' }))
    await expect(getRemoteTrackingBranches(TARGET, { run })).rejects.toThrow('error.failed-read-repo')
  })
})
