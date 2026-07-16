import { describe, expect, test, vi } from 'vitest'
import {
  bootstrapRemoteWorktreeAfterCreate,
  createRemoteWorktree,
  deleteRemoteBranch,
  getRemoteBrowserUrl,
  getRemoteLog,
  getRemoteSnapshot,
  getRemoteStatusAndWorktrees,
  getRemoteTrackingBranches,
  getRemoteTreeWalk,
  getRemoteWorktreeBootstrapPreview,
  pullRemoteBranch,
  fetchRemoteRepo,
  remoteCommandExists,
  pushRemoteBranch,
  remoteExecResult,
  removeRemoteWorktree,
  resolveRemoteWorktree,
} from '#/system/ssh/git.ts'
import type { WorktreeInfo } from '#/shared/git-types.ts'
import type { RemoteCommandResult } from '#/system/ssh/commands.ts'
import { worktreeBootstrapConfigHash } from '#/system/git/worktree-bootstrap.ts'
import { normalizeRemoteTarget } from '#/shared/remote-repo.ts'
import { WORKTREE_STATUS_BATCH_BOUNDARY } from '#/system/git/parsers.ts'

const TARGET = normalizeRemoteTarget({
  alias: 'prod',
  host: 'example.com',
  user: 'alice',
  port: 22,
  remotePath: '/srv/repo',
})!
const LINKED_TARGET = normalizeRemoteTarget({
  alias: 'prod',
  host: 'example.com',
  user: 'alice',
  port: 22,
  remotePath: '/srv/repo-feature',
})!

describe('remote git helpers', () => {
  test('builds browser URLs from remote verbose output', async () => {
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

    await expect(getRemoteBrowserUrl(TARGET, { type: 'root' }, { run: run as any })).resolves.toBe(
      'https://github.com/acme/project',
    )
    await expect(
      getRemoteBrowserUrl(TARGET, { type: 'branch', branch: 'feature/test' }, { run: run as any }),
    ).resolves.toBe('https://github.com/acme/project/tree/feature/test')
    await expect(getRemoteBrowserUrl(TARGET, { type: 'commit', hash: 'abcdef1' }, { run: run as any })).resolves.toBe(
      'https://github.com/acme/project/commit/abcdef1',
    )
  })

  test('getRemoteBrowserUrl rejects unsafe URL targets before running remote commands', async () => {
    const run = vi.fn(async () => okRemoteResult(''))

    await expect(
      getRemoteBrowserUrl(TARGET, { type: 'branch', branch: 'feature/test;echo bad' }, { run: run as any }),
    ).resolves.toBeNull()
    await expect(
      getRemoteBrowserUrl(TARGET, { type: 'commit', hash: 'not-a-hash' }, { run: run as any }),
    ).resolves.toBeNull()

    expect(run).not.toHaveBeenCalled()
  })

  test('includes remote metadata in remote snapshots', async () => {
    const run = async (command: { type: string }) => {
      switch (command.type) {
        case 'gitSnapshot':
          return okRemoteResult(
            [
              '__GOBLIN_REMOTE_CURRENT__',
              'main',
              '__GOBLIN_REMOTE_DEFAULT__',
              'main',
              '__GOBLIN_REMOTE_BRANCHES__',
              'main\x1ff00ba4\x1fInitial commit\x1f2024-01-01T00:00:00Z\x1fAlice\x1forigin/main\x1f',
            ].join('\n'),
          )
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
      remoteExecResult({
        ok: false,
        stdout: '',
        stderr: 'permission denied',
        message: 'unknown',
      } as RemoteCommandResult),
    ).toEqual({ ok: false, message: 'unknown' })
  })

  test('deleteRemoteBranch allows safe delete when branch is merged into current HEAD without upstream', async () => {
    const run = vi.fn(async (command: { type: string; ancestor?: string; descendant?: string; branch?: string }) => {
      switch (command.type) {
        case 'gitSnapshot':
          return okRemoteResult(
            [
              '__GOBLIN_REMOTE_CURRENT__',
              'release/1.0',
              '__GOBLIN_REMOTE_DEFAULT__',
              'main',
              '__GOBLIN_REMOTE_BRANCHES__',
              'release/1.0\x1ff00ba4\x1fRelease\x1f2024-01-01T00:00:00Z\x1fAlice\x1forigin/release/1.0\x1f',
              'feature/test\x1fba5eba1\x1fFeature\x1f2024-01-02T00:00:00Z\x1fAlice\x1f\x1f',
            ].join('\n'),
          )
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

  test('deleteRemoteBranch deletes the configured upstream when requested', async () => {
    const run = vi.fn(async (command: { type: string }) => {
      switch (command.type) {
        case 'gitSnapshot':
          return okRemoteResult(
            [
              '__GOBLIN_REMOTE_CURRENT__',
              'release/1.0',
              '__GOBLIN_REMOTE_DEFAULT__',
              'main',
              '__GOBLIN_REMOTE_BRANCHES__',
              'release/1.0\x1ff00ba4\x1fRelease\x1f2024-01-01T00:00:00Z\x1fAlice\x1forigin/release/1.0\x1f',
              'feature/test\x1fba5eba1\x1fFeature\x1f2024-01-02T00:00:00Z\x1fAlice\x1ffork/topic/feature-test\x1f',
            ].join('\n'),
          )
        case 'gitWorktreeList':
          return okRemoteResult('worktree /srv/repo\nHEAD f00ba4\nbranch refs/heads/release/1.0\n')
        case 'gitStatus':
          return okRemoteResult('')
        case 'gitIsAncestor':
          return okRemoteResult('')
        case 'gitUpstream':
          return okRemoteResult('fork/topic/feature-test')
        case 'gitBranchDelete':
          return okRemoteResult('Deleted branch feature/test')
        case 'gitPushDeleteBranch':
          return okRemoteResult('deleted upstream')
        default:
          return okRemoteResult('')
      }
    })

    const result = await deleteRemoteBranch(TARGET, {
      branch: 'feature/test',
      deleteUpstream: true,
      run: run as any,
    })

    expect(result).toEqual({ ok: true, message: 'deleted upstream' })
    expect(run).toHaveBeenCalledWith(
      { type: 'gitPushDeleteBranch', path: '/srv/repo', remote: 'fork', branch: 'topic/feature-test' },
      TARGET,
      { signal: undefined, timeoutMs: 180_000 },
    )
  })

  test('deleteRemoteBranch reports upstream delete failure after deleting the local branch', async () => {
    const run = vi.fn(async (command: { type: string }) => {
      switch (command.type) {
        case 'gitSnapshot':
          return okRemoteResult(
            [
              '__GOBLIN_REMOTE_CURRENT__',
              'release/1.0',
              '__GOBLIN_REMOTE_DEFAULT__',
              'main',
              '__GOBLIN_REMOTE_BRANCHES__',
              'feature/test\x1fba5eba1\x1fFeature\x1f2024-01-02T00:00:00Z\x1fAlice\x1forigin/feature/test\x1f',
            ].join('\n'),
          )
        case 'gitWorktreeList':
          return okRemoteResult('worktree /srv/repo\nHEAD f00ba4\nbranch refs/heads/release/1.0\n')
        case 'gitStatus':
          return okRemoteResult('')
        case 'gitIsAncestor':
          return okRemoteResult('')
        case 'gitUpstream':
          return okRemoteResult('origin/feature/test')
        case 'gitBranchDelete':
          return okRemoteResult('Deleted branch feature/test')
        case 'gitPushDeleteBranch':
          return failRemoteResult('remote rejected delete')
        default:
          return okRemoteResult('')
      }
    })

    const result = await deleteRemoteBranch(TARGET, {
      branch: 'feature/test',
      deleteUpstream: true,
      run: run as any,
    })

    expect(result).toEqual({ ok: false, message: 'remote rejected delete', repositoryStateChanged: true })
  })

  test('removeRemoteWorktree allows deleting branch when merged into current HEAD without upstream', async () => {
    const run = vi.fn(
      async (command: {
        type: string
        descendant?: string
        worktreePath?: string
        branch?: string
        force?: boolean
      }) => {
        switch (command.type) {
          case 'gitWorktreeList':
            return okRemoteResult(
              [
                'worktree /srv/repo',
                'HEAD f00ba4',
                'branch refs/heads/release/1.0',
                '',
                'worktree /srv/repo-feature',
                'HEAD ba5eba1',
                'branch refs/heads/feature/test',
              ].join('\n'),
            )
          case 'gitStatus':
            return okRemoteResult('')
          case 'gitSnapshot':
            return okRemoteResult(
              [
                '__GOBLIN_REMOTE_CURRENT__',
                'release/1.0',
                '__GOBLIN_REMOTE_DEFAULT__',
                'main',
                '__GOBLIN_REMOTE_BRANCHES__',
                '',
              ].join('\n'),
            )
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
      },
    )

    const result = await removeRemoteWorktree(TARGET, {
      beforeRemove: async () => ({ ok: true, message: '' }),
      afterWorktreeRemoved: async () => ({ ok: true, message: '' }),
      afterRemoveFailed: async () => {},
      branch: 'feature/test',
      worktreePath: '/srv/repo-feature',
      deleteBranch: true,
      run: run as any,
    })

    expect(result).toEqual({
      ok: true,
      message: 'Deleted branch feature/test',
      affectedWorktreePaths: ['/srv/repo', '/srv/repo-feature'],
    })
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

  test('removeRemoteWorktree resolves equivalent absolute worktree paths', async () => {
    const run = vi.fn(async (command: { type: string }) => {
      switch (command.type) {
        case 'gitWorktreeList':
          return okRemoteResult(
            [
              'worktree /srv/repo',
              'HEAD f00ba4',
              'branch refs/heads/main',
              '',
              'worktree /srv/repo-feature',
              'HEAD ba5eba1',
              'branch refs/heads/feature/test',
            ].join('\n'),
          )
        case 'gitStatus':
          return okRemoteResult('')
        case 'gitWorktreeRemove':
          return okRemoteResult('Removed worktree')
        default:
          return okRemoteResult('')
      }
    })

    const result = await removeRemoteWorktree(TARGET, {
      beforeRemove: async () => ({ ok: true, message: '' }),
      afterWorktreeRemoved: async () => ({ ok: true, message: '' }),
      afterRemoveFailed: async () => {},
      branch: 'feature/test',
      worktreePath: '/srv/./repo-feature/',
      deleteBranch: false,
      run: run as any,
    })

    expect(result).toEqual({
      ok: true,
      message: 'Removed worktree',
      affectedWorktreePaths: ['/srv/repo', '/srv/repo-feature'],
    })
    expect(run).toHaveBeenCalledWith(
      { type: 'gitWorktreeRemove', path: '/srv/repo', worktreePath: '/srv/repo-feature' },
      TARGET,
      { timeoutMs: 180_000 },
    )
  })

  test('removeRemoteWorktree rejects relative worktree paths before running remote commands', async () => {
    const run = vi.fn(async () => okRemoteResult(''))

    const result = await removeRemoteWorktree(TARGET, {
      beforeRemove: async () => ({ ok: true, message: '' }),
      afterWorktreeRemoved: async () => ({ ok: true, message: '' }),
      afterRemoveFailed: async () => {},
      branch: 'feature/test',
      worktreePath: 'repo-feature',
      deleteBranch: false,
      run: run as any,
    })

    expect(result).toEqual({ ok: false, message: 'error.invalid-path' })
    expect(run).not.toHaveBeenCalled()
  })

  test('removeRemoteWorktree rejects an equivalent path to the primary worktree', async () => {
    const run = vi.fn(async (command: { type: string }) => {
      if (command.type === 'gitWorktreeList') {
        return okRemoteResult('worktree /srv/repo\nHEAD f00ba4\nbranch refs/heads/main\n')
      }
      return okRemoteResult('')
    })

    const result = await removeRemoteWorktree(TARGET, {
      beforeRemove: async () => ({ ok: true, message: '' }),
      afterWorktreeRemoved: async () => ({ ok: true, message: '' }),
      afterRemoveFailed: async () => {},
      branch: 'main',
      worktreePath: '/srv/./repo/',
      deleteBranch: false,
      run: run as any,
    })

    expect(result).toEqual({ ok: false, message: 'error.cannot-remove-main-worktree' })
    expect(run).toHaveBeenCalledTimes(1)
  })

  test('removeRemoteWorktree deletes the configured upstream after worktree and branch deletion', async () => {
    const run = vi.fn(
      async (command: {
        type: string
        descendant?: string
        worktreePath?: string
        branch?: string
        force?: boolean
      }) => {
        switch (command.type) {
          case 'gitWorktreeList':
            return okRemoteResult(
              [
                'worktree /srv/repo',
                'HEAD f00ba4',
                'branch refs/heads/main',
                '',
                'worktree /srv/repo-feature',
                'HEAD ba5eba1',
                'branch refs/heads/feature/test',
              ].join('\n'),
            )
          case 'gitStatus':
            return okRemoteResult('')
          case 'gitSnapshot':
            return okRemoteResult(
              [
                '__GOBLIN_REMOTE_CURRENT__',
                'main',
                '__GOBLIN_REMOTE_DEFAULT__',
                'main',
                '__GOBLIN_REMOTE_BRANCHES__',
                '',
              ].join('\n'),
            )
          case 'gitIsAncestor':
            return okRemoteResult('')
          case 'gitUpstream':
            return okRemoteResult('fork/topic/feature-test')
          case 'gitWorktreeRemove':
            return okRemoteResult('Removed worktree')
          case 'gitBranchDelete':
            return okRemoteResult('Deleted branch feature/test')
          case 'gitPushDeleteBranch':
            return okRemoteResult('deleted upstream')
          default:
            return okRemoteResult('')
        }
      },
    )

    const result = await removeRemoteWorktree(TARGET, {
      beforeRemove: async () => ({ ok: true, message: '' }),
      afterWorktreeRemoved: async () => ({ ok: true, message: '' }),
      afterRemoveFailed: async () => {},
      branch: 'feature/test',
      worktreePath: '/srv/repo-feature',
      deleteBranch: true,
      deleteUpstream: true,
      run: run as any,
    })

    expect(result).toEqual({
      ok: true,
      message: 'deleted upstream',
      affectedWorktreePaths: ['/srv/repo', '/srv/repo-feature'],
    })
    expect(run).toHaveBeenCalledWith(
      { type: 'gitPushDeleteBranch', path: '/srv/repo', remote: 'fork', branch: 'topic/feature-test' },
      TARGET,
      { signal: undefined, timeoutMs: 180_000 },
    )
  })

  test('removeRemoteWorktree rejects unsafe branch names before running remote commands', async () => {
    const run = vi.fn(async () => okRemoteResult(''))

    const result = await removeRemoteWorktree(TARGET, {
      beforeRemove: async () => ({ ok: true, message: '' }),
      afterWorktreeRemoved: async () => ({ ok: true, message: '' }),
      afterRemoveFailed: async () => {},
      branch: 'feature/test;echo bad',
      worktreePath: '/srv/repo-feature',
      deleteBranch: true,
      run: run as any,
    })

    expect(result).toEqual({ ok: false, message: 'error.invalid-arguments' })
    expect(run).not.toHaveBeenCalled()
  })

  test('removeRemoteWorktree removes the currently opened linked worktree from the primary path', async () => {
    const run = vi.fn(
      async (command: {
        type: string
        path?: string
        descendant?: string
        worktreePath?: string
        branch?: string
        force?: boolean
      }) => {
        switch (command.type) {
          case 'gitWorktreeList':
            return okRemoteResult(
              [
                'worktree /srv/repo',
                'HEAD f00ba4',
                'branch refs/heads/main',
                '',
                'worktree /srv/repo-feature',
                'HEAD ba5eba1',
                'branch refs/heads/feature/test',
              ].join('\n'),
            )
          case 'gitStatus':
            return okRemoteResult('')
          case 'gitSnapshot':
            return command.path === '/srv/repo'
              ? okRemoteResult(
                  [
                    '__GOBLIN_REMOTE_CURRENT__',
                    'main',
                    '__GOBLIN_REMOTE_DEFAULT__',
                    'main',
                    '__GOBLIN_REMOTE_BRANCHES__',
                    '',
                  ].join('\n'),
                )
              : failRemoteResult('removed cwd should not be used')
          case 'gitIsAncestor':
            return command.path === '/srv/repo' && command.descendant === 'main'
              ? okRemoteResult('')
              : failRemoteResult('not merged')
          case 'gitUpstream':
            return failRemoteResult('no upstream')
          case 'gitWorktreeRemove':
            return okRemoteResult('Removed worktree')
          case 'gitBranchDelete':
            return okRemoteResult('Deleted branch feature/test')
          default:
            return okRemoteResult('')
        }
      },
    )

    const result = await removeRemoteWorktree(LINKED_TARGET, {
      beforeRemove: async () => ({ ok: true, message: '' }),
      afterWorktreeRemoved: async () => ({ ok: true, message: '' }),
      afterRemoveFailed: async () => {},
      branch: 'feature/test',
      worktreePath: '/srv/repo-feature',
      deleteBranch: true,
      run: run as any,
    })

    expect(result).toEqual({
      ok: true,
      message: 'Deleted branch feature/test',
      affectedWorktreePaths: ['/srv/repo', '/srv/repo-feature'],
    })
    expect(run).toHaveBeenCalledWith({ type: 'gitSnapshot', path: '/srv/repo' }, LINKED_TARGET, { signal: undefined })
    expect(run).toHaveBeenCalledWith(
      { type: 'gitWorktreeRemove', path: '/srv/repo', worktreePath: '/srv/repo-feature' },
      LINKED_TARGET,
      { signal: undefined, timeoutMs: 180_000 },
    )
    expect(run).toHaveBeenCalledWith(
      { type: 'gitBranchDelete', path: '/srv/repo', branch: 'feature/test', force: false },
      LINKED_TARGET,
      { signal: undefined, timeoutMs: 180_000 },
    )
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
          return okRemoteResult(
            [
              '__GOBLIN_REMOTE_CURRENT__',
              'main',
              '__GOBLIN_REMOTE_DEFAULT__',
              'main',
              '__GOBLIN_REMOTE_BRANCHES__',
              '',
            ].join('\n'),
          )
        case 'gitUpstream':
          return okRemoteResult('fork/feature/test')
        case 'gitRemoteVerbose':
          return okRemoteResult(
            'origin\tgit@github.com:acme/project.git (fetch)\norigin\tgit@github.com:acme/project.git (push)',
          )
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
          return okRemoteResult(
            [
              'origin\tgit@github.com:acme/project.git (fetch)',
              'origin\tgit@github.com:acme/project.git (push)',
              'fork\tgit@github.com:alice/project.git (fetch)',
              'fork\tgit@github.com:alice/project.git (push)',
            ].join('\n'),
          )
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
          return okRemoteResult(
            'origin\tgit@github.com:acme/project.git (fetch)\norigin\tgit@github.com:acme/project.git (push)',
          )
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

  test('fetchRemoteRepo prefers the current branch upstream remote over fetch --all', async () => {
    const run = vi.fn(async (command: { type: string; remote?: string; branch?: string }) => {
      switch (command.type) {
        case 'gitSnapshot':
          return okRemoteResult(
            [
              '__GOBLIN_REMOTE_CURRENT__',
              'feature/test',
              '__GOBLIN_REMOTE_DEFAULT__',
              'main',
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
          return okRemoteResult('fork/feature/test')
        case 'gitFetchRemote':
          return okRemoteResult(`fetched ${command.remote}`)
        default:
          return okRemoteResult('')
      }
    })

    const result = await fetchRemoteRepo(TARGET, { run: run as any })

    expect(result).toEqual({ ok: true, message: 'fetched fork' })
    expect(run).toHaveBeenCalledWith({ type: 'gitFetchRemote', path: '/srv/repo', remote: 'fork' }, TARGET, {
      signal: undefined,
      timeoutMs: 180_000,
    })
    expect(run).not.toHaveBeenCalledWith({ type: 'gitFetchAll', path: '/srv/repo' }, TARGET, expect.anything())
  })

  test('getRemoteTrackingBranches filters */HEAD and malformed refs', async () => {
    const run = vi.fn(async () =>
      okRemoteResult(
        ['origin/HEAD', 'origin/main', 'origin/feature/auth', 'origin/feature/ui', 'not-a-valid-ref-line'].join('\n'),
      ),
    )
    const refs = await getRemoteTrackingBranches(TARGET, { run })
    expect(run).toHaveBeenCalledWith({ type: 'gitRemoteBranches', path: '/srv/repo' }, TARGET, { signal: undefined })
    expect(refs).toEqual(['origin/main', 'origin/feature/auth', 'origin/feature/ui'])
  })

  test('getRemoteTrackingBranches returns [] when the remote command fails', async () => {
    const run = vi.fn(async () => ({ ok: false, stdout: '', stderr: 'ssh: connection refused' }))
    const refs = await getRemoteTrackingBranches(TARGET, { run })
    expect(refs).toEqual([])
  })

  test('getRemoteWorktreeBootstrapPreview reads config without running bootstrap', async () => {
    const run = vi.fn(async (command: { type: string }) => {
      if (command.type === 'readRemoteFile') {
        return okRemoteResult(
          '[worktree]\ncopy = [".env", "config/*"]\nsymlink = ["linked.txt"]\nexclude = ["config/*.log"]\nsetup = "bun install"',
        )
      }
      return okRemoteResult('')
    })

    const result = await getRemoteWorktreeBootstrapPreview(TARGET, { run: run as any })

    expect(result).toEqual({
      ok: true,
      preview: {
        hasConfig: true,
        hasOperations: true,
        configHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        copyCount: 2,
        symlinkCount: 1,
        hardlinkCount: 0,
        excludeCount: 1,
        setup: { command: 'bun install' },
      },
    })
    expect(run).toHaveBeenCalledWith({ type: 'revParseTopLevel', path: '/srv/repo' }, TARGET, {
      signal: undefined,
      timeoutMs: 180_000,
    })
    expect(run).toHaveBeenCalledWith({ type: 'readRemoteFile', path: '/srv/repo/goblin.toml' }, TARGET, {
      signal: undefined,
      timeoutMs: 180_000,
    })
    expect(run).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'bootstrapRemoteWorktree' }),
      expect.anything(),
      expect.anything(),
    )
  })

  test('bootstrapRemoteWorktreeAfterCreate does nothing when goblin.toml is absent', async () => {
    const run = vi.fn(async (command: { type: string }) => {
      if (command.type === 'readRemoteFile') return okRemoteResult('')
      return okRemoteResult('')
    })

    const result = await bootstrapRemoteWorktreeAfterCreate(TARGET, '/srv/repo-worktree', { run: run as any })

    expect(result).toEqual({ ok: true, message: '' })
    expect(run).toHaveBeenCalledTimes(2)
  })

  test('bootstrapRemoteWorktreeAfterCreate runs remote bootstrap and formats output', async () => {
    const run = vi.fn(async (command: { type: string }) => {
      if (command.type === 'readRemoteFile') {
        return okRemoteResult('[worktree]\ncopy = [".env"]\nsetup = "bun install"')
      }
      if (command.type === 'bootstrapRemoteWorktree') {
        return okRemoteResult('GOBLIN_BOOTSTRAP_COPY .env\nGOBLIN_BOOTSTRAP_SETUP bun install')
      }
      return okRemoteResult('')
    })

    const result = await bootstrapRemoteWorktreeAfterCreate(TARGET, '/srv/repo-worktree', { run: run as any })

    expect(result).toEqual({
      ok: true,
      message: 'Copied 1 path: .env\nRan setup: bun install',
      worktreeBootstrap: {
        copy: { count: 1, paths: ['.env'] },
        symlink: { count: 0, paths: [] },
        hardlink: { count: 0, paths: [] },
        skippedMissing: { count: 0, paths: [] },
        setup: { command: 'bun install' },
      },
    })
    expect(run).toHaveBeenCalledWith({ type: 'revParseTopLevel', path: '/srv/repo' }, TARGET, {
      signal: undefined,
      timeoutMs: 180_000,
    })
    expect(run).toHaveBeenCalledWith({ type: 'readRemoteFile', path: '/srv/repo/goblin.toml' }, TARGET, {
      signal: undefined,
      timeoutMs: 180_000,
    })
    expect(run).toHaveBeenCalledWith(
      {
        type: 'bootstrapRemoteWorktree',
        sourceRoot: '/srv/repo',
        targetRoot: '/srv/repo-worktree',
        copy: ['.env'],
        symlink: [],
        hardlink: [],
        exclude: [],
        setup: 'bun install',
      },
      TARGET,
      { signal: undefined, timeoutMs: 600_000 },
    )
  })

  test('bootstrapRemoteWorktreeAfterCreate does not run when goblin.toml changed after confirmation', async () => {
    const trustedHash = worktreeBootstrapConfigHash('[worktree]\ncopy = [".env"]')
    const run = vi.fn(async (command: { type: string }) => {
      if (command.type === 'readRemoteFile') return okRemoteResult('[worktree]\ncopy = ["other.env"]')
      if (command.type === 'bootstrapRemoteWorktree') return okRemoteResult('GOBLIN_BOOTSTRAP_COPY other.env')
      return okRemoteResult('')
    })

    const result = await bootstrapRemoteWorktreeAfterCreate(TARGET, '/srv/repo-worktree', {
      run: run as any,
      expectedConfigHash: trustedHash,
    })

    expect(result).toEqual({
      ok: false,
      message: 'Worktree bootstrap failed: goblin.toml changed after confirmation',
    })
    expect(run).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'bootstrapRemoteWorktree' }),
      expect.anything(),
      expect.anything(),
    )
  })

  test('bootstrapRemoteWorktreeAfterCreate reads config from the remote repo root', async () => {
    const target = normalizeRemoteTarget({
      alias: 'prod',
      host: 'example.com',
      user: 'alice',
      port: 22,
      remotePath: '/srv/repo/packages/app',
    })!
    const run = vi.fn(async (command: { type: string }) => {
      if (command.type === 'revParseTopLevel') return okRemoteResult('/srv/repo')
      if (command.type === 'readRemoteFile') return okRemoteResult('[worktree]\ncopy = [".env"]')
      if (command.type === 'bootstrapRemoteWorktree') return okRemoteResult('GOBLIN_BOOTSTRAP_COPY .env')
      return okRemoteResult('')
    })

    const result = await bootstrapRemoteWorktreeAfterCreate(target, '/srv/repo-worktree', { run: run as any })

    expect(result.ok).toBe(true)
    expect(run).toHaveBeenCalledWith({ type: 'readRemoteFile', path: '/srv/repo/goblin.toml' }, target, {
      signal: undefined,
      timeoutMs: 180_000,
    })
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'bootstrapRemoteWorktree', sourceRoot: '/srv/repo' }),
      target,
      { signal: undefined, timeoutMs: 600_000 },
    )
  })

  test('bootstrapRemoteWorktreeAfterCreate returns error when config is invalid', async () => {
    const run = vi.fn(async (command: { type: string }) => {
      if (command.type === 'readRemoteFile') return okRemoteResult('[worktree]\ncopy = "not-an-array"')
      return okRemoteResult('')
    })

    const result = await bootstrapRemoteWorktreeAfterCreate(TARGET, '/srv/repo-worktree', { run: run as any })

    expect(result.ok).toBe(false)
    expect(result.message).toContain('Worktree bootstrap failed')
  })

  test('bootstrapRemoteWorktreeAfterCreate rejects unsafe paths before running remote bootstrap', async () => {
    const run = vi.fn(async (command: { type: string }) => {
      if (command.type === 'readRemoteFile') return okRemoteResult('[worktree]\ncopy = ["../secret.env"]')
      return okRemoteResult('')
    })

    const result = await bootstrapRemoteWorktreeAfterCreate(TARGET, '/srv/repo-worktree', { run: run as any })

    expect(result.ok).toBe(false)
    expect(result.message).toContain('bootstrap path escapes repo root')
    expect(run).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'bootstrapRemoteWorktree' }),
      expect.anything(),
      expect.anything(),
    )
  })

  test('bootstrapRemoteWorktreeAfterCreate returns error when remote bootstrap fails', async () => {
    const run = vi.fn(async (command: { type: string }) => {
      if (command.type === 'readRemoteFile') return okRemoteResult('[worktree]\nsetup = "bun install"')
      if (command.type === 'bootstrapRemoteWorktree') return failRemoteResult('bun: command not found')
      return okRemoteResult('')
    })

    const result = await bootstrapRemoteWorktreeAfterCreate(TARGET, '/srv/repo-worktree', { run: run as any })

    expect(result.ok).toBe(false)
    expect(result.message).toContain('bun: command not found')
  })

  test('getRemoteLog rejects unsafe branch names before running remote commands', async () => {
    const run = vi.fn()

    const entries = await getRemoteLog(TARGET, '../feature', undefined, undefined, { run: run as any })

    expect(entries).toEqual([])
    expect(run).not.toHaveBeenCalled()
  })

  test('deleteRemoteBranch rejects unsafe branch names before running remote commands', async () => {
    const run = vi.fn()

    const result = await deleteRemoteBranch(TARGET, { branch: '../feature', run: run as any })

    expect(result).toEqual({ ok: false, message: 'error.invalid-arguments' })
    expect(run).not.toHaveBeenCalled()
  })
})

describe('getRemoteStatusAndWorktrees', () => {
  const NUL = String.fromCharCode(0)

  function buildBatchedOutput(worktreeListOutput: string, statusStream: string): string {
    return `${worktreeListOutput}\n${WORKTREE_STATUS_BATCH_BOUNDARY}\n${statusStream}`
  }

  test('parses the batched command output into statuses + worktrees in one SSH call', async () => {
    const worktreeListOutput = [
      'worktree /srv/repo',
      'HEAD f00ba4',
      'branch refs/heads/main',
      '',
      'worktree /srv/repo-feature',
      'HEAD ba5eba1',
      'branch refs/heads/feature/test',
    ].join('\n')
    const statusStream = [
      `/srv/repo${NUL}M  README.md${NUL}${NUL}`,
      `/srv/repo-feature${NUL}?? new.ts${NUL}${NUL}`,
    ].join('')
    const run = vi.fn(async () => okRemoteResult(buildBatchedOutput(worktreeListOutput, statusStream)))

    const result = await getRemoteStatusAndWorktrees(TARGET, { run: run as any })

    expect(run).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledWith({ type: 'gitWorktreeListAndStatus', path: '/srv/repo' }, TARGET, {
      signal: undefined,
    })
    expect(result.worktrees).toHaveLength(2)
    expect(result.worktrees[0]).toMatchObject({ path: '/srv/repo', branch: 'main', isPrimary: true, isBare: false })
    expect(result.worktrees[1]).toMatchObject({ path: '/srv/repo-feature', branch: 'feature/test', isPrimary: false })
    expect(result.statuses).toHaveLength(2)
    expect(result.statuses[0]).toMatchObject({
      path: '/srv/repo',
      branch: 'main',
      isMain: true,
    })
    expect(result.statuses[0]?.entries).toEqual([{ x: 'M', y: ' ', path: 'README.md' }])
    expect(result.statuses[1]?.entries).toEqual([{ x: '?', y: '?', path: 'new.ts' }])
  })

  test('treats bare worktrees as absent from statuses but keeps them in the worktree list', async () => {
    const worktreeListOutput = [
      'worktree /srv/repo',
      'bare',
      '',
      'worktree /srv/repo-feature',
      'HEAD ba5eba1',
      'branch refs/heads/feature/test',
    ].join('\n')
    const statusStream = `/srv/repo-feature${NUL}${NUL}`
    const run = vi.fn(async () => okRemoteResult(buildBatchedOutput(worktreeListOutput, statusStream)))

    const result = await getRemoteStatusAndWorktrees(TARGET, { run: run as any })

    // worktrees still includes the bare entry (callers may need it)
    expect(result.worktrees).toHaveLength(2)
    expect(result.worktrees[0]?.isBare).toBe(true)
    // statuses excludes the bare entry
    expect(result.statuses).toHaveLength(1)
    expect(result.statuses[0]?.path).toBe('/srv/repo-feature')
  })

  test('rejects when the remote command fails', async () => {
    const run = vi.fn(async () => failRemoteResult('boom'))
    await expect(getRemoteStatusAndWorktrees(TARGET, { run: run as any })).rejects.toThrow('boom')
  })

  test('rejects when a non-bare worktree is missing from the status stream', async () => {
    const worktreeListOutput = ['worktree /srv/repo', 'HEAD f00ba4', 'branch refs/heads/main'].join('\n')
    const run = vi.fn(async () => okRemoteResult(buildBatchedOutput(worktreeListOutput, '')))

    await expect(getRemoteStatusAndWorktrees(TARGET, { run: run as any })).rejects.toThrow('error.failed-read-repo')
  })
})

describe('getRemoteTreeWalk knownWorktrees path', () => {
  test('skips gitWorktreeList when knownWorktrees is supplied', async () => {
    // Regression for the B4 round-trip optimisation: when the caller
    // already has a worktree list (because `getRemoteStatusAndWorktrees`
    // returned one in the same request), the walk path must NOT pay
    // a second `gitWorktreeList` SSH call.
    const knownWorktrees: WorktreeInfo[] = [
      { path: '/srv/repo-feature', branch: 'feature/test', isBare: false, isPrimary: false },
    ]
    const run = vi.fn(async (command: { type: string }) => {
      const NUL = String.fromCharCode(0)
      switch (command.type) {
        case 'gitTreeWalk':
          return okRemoteResult(`/srv/repo-feature/README.md${NUL}/srv/repo-feature/src/foo.ts`)
        default:
          return failRemoteResult('should not be called')
      }
    })

    const result = await getRemoteTreeWalk(TARGET, '/srv/repo-feature', {
      run: run as any,
      knownWorktrees,
    })

    expect(result).toMatchObject({ ok: true })
    const treeWalkCall = run.mock.calls.find(([command]) => command.type === 'gitTreeWalk')
    expect(treeWalkCall).toBeDefined()
    expect(run).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'gitWorktreeList' }),
      expect.anything(),
      expect.anything(),
    )
  })

  test('still falls back to gitWorktreeList when knownWorktrees is omitted', async () => {
    const run = vi.fn(async (command: { type: string }) => {
      switch (command.type) {
        case 'gitWorktreeList':
          return okRemoteResult(['worktree /srv/repo-feature', 'HEAD a', 'branch refs/heads/feat'].join('\n'))
        case 'gitTreeWalk':
          return okRemoteResult('')
        default:
          return failRemoteResult('unexpected')
      }
    })

    const result = await getRemoteTreeWalk(TARGET, '/srv/repo-feature', { run: run as any })

    expect(result).toMatchObject({ ok: true })
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'gitWorktreeList' }),
      expect.anything(),
      expect.anything(),
    )
  })

  test('rejects a request for an unknown worktree path even when knownWorktrees is supplied', async () => {
    const knownWorktrees: WorktreeInfo[] = [{ path: '/srv/repo', branch: 'main', isBare: false, isPrimary: true }]
    const run = vi.fn()
    const result = await getRemoteTreeWalk(TARGET, '/srv/repo-missing', {
      run: run as any,
      knownWorktrees,
    })
    expect(result).toEqual({ ok: false, message: 'error.worktree-not-found' })
    expect(run).not.toHaveBeenCalled()
  })
})

describe('resolveRemoteWorktree', () => {
  test('returns the canonical known worktree path after POSIX normalization', async () => {
    const knownWorktrees: WorktreeInfo[] = [
      { path: '/srv/repo-feature', branch: 'feature/test', isBare: false, isPrimary: false },
    ]
    const run = vi.fn()

    const result = await resolveRemoteWorktree(TARGET, '/srv/repo-feature/', {
      run: run as any,
      knownWorktrees,
    })

    expect(result).toEqual(knownWorktrees[0])
    expect(run).not.toHaveBeenCalled()
  })

  test('throws the remote read failure instead of returning an empty authority set', async () => {
    const run = vi.fn(async () => failRemoteResult('ssh unavailable'))

    await expect(resolveRemoteWorktree(TARGET, '/srv/repo-feature', { run: run as any })).rejects.toThrow(
      'ssh unavailable',
    )

    expect(run).toHaveBeenCalledWith({ type: 'gitWorktreeList', path: '/srv/repo' }, TARGET, { signal: undefined })
  })
})

describe('remoteCommandExists', () => {
  test('validates the remote worktree before checking the command', async () => {
    const knownWorktrees: WorktreeInfo[] = [
      { path: '/srv/repo-feature', branch: 'feature/test', isBare: false, isPrimary: false },
    ]
    const run = vi.fn(async (command: { type: string }) => {
      if (command.type === 'commandExists') return okRemoteResult('')
      return failRemoteResult('unexpected')
    })

    const result = await remoteCommandExists(TARGET, '/srv/repo-feature', 'bat', {
      run: run as any,
      knownWorktrees,
    })

    expect(result).toBe(true)
    expect(run).toHaveBeenCalledWith({ type: 'commandExists', path: '/srv/repo-feature', commandName: 'bat' }, TARGET, {
      signal: undefined,
    })
    expect(run).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'gitWorktreeList' }),
      expect.anything(),
      expect.anything(),
    )
  })

  test('matches known remote worktrees after POSIX path normalization', async () => {
    const knownWorktrees: WorktreeInfo[] = [
      { path: '/srv/repo-feature', branch: 'feature/test', isBare: false, isPrimary: false },
    ]
    const run = vi.fn(async (command: { type: string }) => {
      if (command.type === 'commandExists') return okRemoteResult('')
      return failRemoteResult('unexpected')
    })

    const result = await remoteCommandExists(TARGET, '/srv/repo-feature/', 'bat', {
      run: run as any,
      knownWorktrees,
    })

    expect(result).toBe(true)
    expect(run).toHaveBeenCalledWith({ type: 'commandExists', path: '/srv/repo-feature', commandName: 'bat' }, TARGET, {
      signal: undefined,
    })
  })

  test('returns false for unsafe command names without touching the remote', async () => {
    const run = vi.fn()

    const result = await remoteCommandExists(TARGET, '/srv/repo-feature', 'bat; whoami', { run: run as any })

    expect(result).toBe(false)
    expect(run).not.toHaveBeenCalled()
  })

  test('returns false for unknown worktrees', async () => {
    const run = vi.fn()

    const result = await remoteCommandExists(TARGET, '/srv/missing', 'bat', {
      run: run as any,
      knownWorktrees: [{ path: '/srv/repo-feature', branch: 'feature/test', isBare: false, isPrimary: false }],
    })

    expect(result).toBe(false)
    expect(run).not.toHaveBeenCalled()
  })
})

function okRemoteResult(stdout: string): RemoteCommandResult {
  return { ok: true, stdout, stderr: '' }
}

function failRemoteResult(message: string): RemoteCommandResult {
  return { ok: false, stdout: '', stderr: message, message }
}
