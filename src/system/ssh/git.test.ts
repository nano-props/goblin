import { describe, expect, test, vi } from 'vitest'
import {
  checkoutRemoteBranch,
  createRemoteWorktree,
  deleteRemoteBranch,
  getRemoteBrowserUrl,
  getRemoteSnapshot,
  pullRemoteBranch,
  fetchRemoteRepository,
  pushRemoteBranch,
  remoteExecResult,
  removeRemoteWorktree,
} from '#/system/ssh/git.ts'
import type { RemoteCommandResult } from '#/system/ssh/commands.ts'
import { normalizeRemoteTarget } from '#/shared/remote-repo.ts'

const TARGET = normalizeRemoteTarget({
  alias: 'prod',
  host: 'example.com',
  user: 'alice',
  port: 22,
  remotePath: '/srv/repo',
})!

describe('remote git helpers', () => {
  test('builds browser and pull request URLs from remote verbose output', async () => {
    const run = async (command: { type: string }) => {
      switch (command.type) {
        case 'gitRemoteVerbose':
          return okRemoteResult(
            'origin\tgit@github.com:acme/project.git (fetch)\norigin\tgit@github.com:acme/project.git (push)',
          )
        case 'gitUpstream':
          return okRemoteResult('origin/feature/test')
        default:
          return okRemoteResult('')
      }
    }

    await expect(getRemoteBrowserUrl(TARGET, undefined, { run: run as any })).resolves.toBe('https://github.com/acme/project')
    await expect(getRemoteBrowserUrl(TARGET, 'feature/test', { run: run as any })).resolves.toBe(
      'https://github.com/acme/project/pull/new/feature/test',
    )
  })

  test('includes remote metadata in remote snapshots', async () => {
    const run = async (command: { type: string }) => {
      switch (command.type) {
        case 'gitSnapshot':
          return okRemoteResult([
            '__GOBLIN_REMOTE_CURRENT__',
            'main',
            '__GOBLIN_REMOTE_DEFAULT__',
            'main',
            '__GOBLIN_REMOTE_BRANCHES__',
            'main\x1ff00ba4\x1fInitial commit\x1f2024-01-01T00:00:00Z\x1fAlice\x1forigin/main\x1f',
          ].join('\n'))
        case 'gitWorktreeList':
          return okRemoteResult('worktree /srv/repo\nHEAD f00ba4\nbranch refs/heads/main\n')
        case 'gitStatus':
          return okRemoteResult('')
        case 'gitRemoteVerbose':
          return okRemoteResult(
            'origin\tgit@gitlab.com:acme/project.git (fetch)\norigin\tgit@gitlab.com:acme/project.git (push)',
          )
        default:
          return okRemoteResult('')
      }
    }

    const snapshot = await getRemoteSnapshot(TARGET, { run: run as any })

    expect(snapshot?.remote).toMatchObject({
      hasRemotes: true,
      hasBrowserRemote: true,
      browserRemoteProvider: 'gitlab',
      hasGitHubRemote: false,
    })
  })

  test('prefers stderr when converting remote exec failures', () => {
    expect(
      remoteExecResult({ ok: false, stdout: '', stderr: 'permission denied', message: 'unknown' } as RemoteCommandResult),
    ).toEqual({ ok: false, message: 'unknown' })
  })

  test('deleteRemoteBranch allows safe delete when branch is merged into current HEAD without upstream', async () => {
    const run = vi.fn(async (command: { type: string; ancestor?: string; descendant?: string; branch?: string }) => {
      switch (command.type) {
        case 'gitSnapshot':
          return okRemoteResult([
            '__GOBLIN_REMOTE_CURRENT__',
            'release/1.0',
            '__GOBLIN_REMOTE_DEFAULT__',
            'main',
            '__GOBLIN_REMOTE_BRANCHES__',
            'release/1.0\x1ff00ba4\x1fRelease\x1f2024-01-01T00:00:00Z\x1fAlice\x1forigin/release/1.0\x1f',
            'feature/test\x1fba5eba1\x1fFeature\x1f2024-01-02T00:00:00Z\x1fAlice\x1f\x1f',
          ].join('\n'))
        case 'gitWorktreeList':
          return okRemoteResult('worktree /srv/repo\nHEAD f00ba4\nbranch refs/heads/release/1.0\n')
        case 'gitStatus':
          return okRemoteResult('')
        case 'gitRemoteVerbose':
          return okRemoteResult('')
        case 'gitIsAncestor':
          return command.descendant === 'release/1.0' ? okRemoteResult('') : failRemoteResult('not merged')
        case 'gitUpstream':
          return failRemoteResult('no upstream')
        case 'gitBranchDelete':
          return okRemoteResult('Deleted branch feature/test')
        default:
          return okRemoteResult('')
      }
    })

    const result = await deleteRemoteBranch(TARGET, { branch: 'feature/test', run: run as any })

    expect(result).toEqual({ ok: true, message: 'Deleted branch feature/test' })
    expect(run).toHaveBeenCalledWith(
      { type: 'gitIsAncestor', path: '/srv/repo', ancestor: 'feature/test', descendant: 'release/1.0' },
      TARGET,
      { signal: undefined },
    )
  })

  test('removeRemoteWorktree allows deleting branch when merged into current HEAD without upstream', async () => {
    const run = vi.fn(async (command: { type: string; descendant?: string; worktreePath?: string; branch?: string; force?: boolean }) => {
      switch (command.type) {
        case 'gitWorktreeList':
          return okRemoteResult([
            'worktree /srv/repo',
            'HEAD f00ba4',
            'branch refs/heads/release/1.0',
            '',
            'worktree /srv/repo-feature',
            'HEAD ba5eba1',
            'branch refs/heads/feature/test',
          ].join('\n'))
        case 'gitStatus':
          return okRemoteResult('')
        case 'gitSnapshot':
          return okRemoteResult([
            '__GOBLIN_REMOTE_CURRENT__',
            'release/1.0',
            '__GOBLIN_REMOTE_DEFAULT__',
            'main',
            '__GOBLIN_REMOTE_BRANCHES__',
            '',
          ].join('\n'))
        case 'gitIsAncestor':
          return command.descendant === 'release/1.0' ? okRemoteResult('') : failRemoteResult('not merged')
        case 'gitUpstream':
          return failRemoteResult('no upstream')
        case 'gitWorktreeRemove':
          return okRemoteResult('Removed worktree')
        case 'gitBranchDelete':
          return okRemoteResult('Deleted branch feature/test')
        default:
          return okRemoteResult('')
      }
    })

    const result = await removeRemoteWorktree(TARGET, {
      branch: 'feature/test',
      worktreePath: '/srv/repo-feature',
      alsoDeleteBranch: true,
      run: run as any,
    })

    expect(result).toEqual({ ok: true, message: 'Deleted branch feature/test' })
    expect(run).toHaveBeenCalledWith(
      { type: 'gitWorktreeRemove', path: '/srv/repo', worktreePath: '/srv/repo-feature' },
      TARGET,
      { signal: undefined, timeoutMs: 180_000 },
    )
    expect(run).toHaveBeenCalledWith(
      { type: 'gitBranchDelete', path: '/srv/repo', branch: 'feature/test', force: false },
      TARGET,
      { signal: undefined, timeoutMs: 180_000 },
    )
  })

  test('checkoutRemoteBranch rejects invalid branch names before running remote commands', async () => {
    const run = vi.fn()

    const result = await checkoutRemoteBranch(TARGET, '-bad', undefined, { run: run as any })

    expect(result).toEqual({ ok: false, message: 'error.invalid-arguments' })
    expect(run).not.toHaveBeenCalled()
  })

  test('createRemoteWorktree rejects relative paths before running remote commands', async () => {
    const run = vi.fn()

    const result = await createRemoteWorktree(TARGET, {
      worktreePath: 'relative/path',
      mode: { kind: 'newBranch', newBranch: 'feature/test', baseRef: 'main' },
      run: run as any,
    })

    expect(result).toEqual({ ok: false, message: 'error.invalid-path' })
    expect(run).not.toHaveBeenCalled()
  })

  test('pullRemoteBranch reports missing upstream remote explicitly', async () => {
    const run = vi.fn(async (command: { type: string }) => {
      switch (command.type) {
        case 'gitSnapshot':
          return okRemoteResult([
            '__GOBLIN_REMOTE_CURRENT__',
            'main',
            '__GOBLIN_REMOTE_DEFAULT__',
            'main',
            '__GOBLIN_REMOTE_BRANCHES__',
            '',
          ].join('\n'))
        case 'gitUpstream':
          return okRemoteResult('fork/feature/test')
        case 'gitRemoteVerbose':
          return okRemoteResult('origin\tgit@github.com:acme/project.git (fetch)\norigin\tgit@github.com:acme/project.git (push)')
        default:
          return okRemoteResult('')
      }
    })

    const result = await pullRemoteBranch(TARGET, 'feature/test', undefined, { run: run as any })

    expect(result).toEqual({ ok: false, message: 'error.pull-no-remote' })
  })

  test('pushRemoteBranch prefers the configured upstream remote and branch', async () => {
    const run = vi.fn(async (command: { type: string }) => {
      switch (command.type) {
        case 'gitRemoteVerbose':
          return okRemoteResult([
            'origin\tgit@github.com:acme/project.git (fetch)',
            'origin\tgit@github.com:acme/project.git (push)',
            'fork\tgit@github.com:alice/project.git (fetch)',
            'fork\tgit@github.com:alice/project.git (push)',
          ].join('\n'))
        case 'gitUpstream':
          return okRemoteResult('fork/topic/feature-test')
        case 'gitPush':
          return okRemoteResult('pushed')
        default:
          return okRemoteResult('')
      }
    })

    const result = await pushRemoteBranch(TARGET, 'feature/test', { run: run as any })

    expect(result).toEqual({ ok: true, message: 'pushed' })
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
    const run = vi.fn(async (command: { type: string }) => {
      switch (command.type) {
        case 'gitRemoteVerbose':
          return okRemoteResult('origin\tgit@github.com:acme/project.git (fetch)\norigin\tgit@github.com:acme/project.git (push)')
        case 'gitUpstream':
          return failRemoteResult('no upstream')
        case 'gitPush':
          return okRemoteResult('pushed')
        default:
          return okRemoteResult('')
      }
    })

    const result = await pushRemoteBranch(TARGET, 'feature/test', { run: run as any })

    expect(result).toEqual({ ok: true, message: 'pushed' })
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

  test('fetchRemoteRepository prefers the current branch upstream remote over fetch --all', async () => {
    const run = vi.fn(async (command: { type: string; remote?: string; branch?: string }) => {
      switch (command.type) {
        case 'gitSnapshot':
          return okRemoteResult([
            '__GOBLIN_REMOTE_CURRENT__',
            'feature/test',
            '__GOBLIN_REMOTE_DEFAULT__',
            'main',
            '__GOBLIN_REMOTE_BRANCHES__',
            '',
          ].join('\n'))
        case 'gitRemoteVerbose':
          return okRemoteResult([
            'origin\tgit@github.com:acme/project.git (fetch)',
            'origin\tgit@github.com:acme/project.git (push)',
            'fork\tgit@github.com:alice/project.git (fetch)',
            'fork\tgit@github.com:alice/project.git (push)',
          ].join('\n'))
        case 'gitUpstream':
          return okRemoteResult('fork/feature/test')
        case 'gitFetchRemote':
          return okRemoteResult(`fetched ${command.remote}`)
        default:
          return okRemoteResult('')
      }
    })

    const result = await fetchRemoteRepository(TARGET, { run: run as any })

    expect(result).toEqual({ ok: true, message: 'fetched fork' })
    expect(run).toHaveBeenCalledWith(
      { type: 'gitFetchRemote', path: '/srv/repo', remote: 'fork' },
      TARGET,
      { signal: undefined, timeoutMs: 180_000 },
    )
    expect(run).not.toHaveBeenCalledWith(
      { type: 'gitFetchAll', path: '/srv/repo' },
      TARGET,
      expect.anything(),
    )
  })
})

function okRemoteResult(stdout: string): RemoteCommandResult {
  return { ok: true, stdout, stderr: '' }
}

function failRemoteResult(message: string): RemoteCommandResult {
  return { ok: false, stdout: '', stderr: message, message }
}
