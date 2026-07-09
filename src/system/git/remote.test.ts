import { describe, expect, test, vi } from 'vitest'
import {
  branchUrlForBrowserRemote,
  commitUrlForBrowserRemote,
  fetchAll,
  getBrowserRepoUrl,
  getRepoUrlForRemotes,
  resolveFetchRemoteForRemotes,
  resolvePushTargetForRemotes,
} from '#/system/git/remote.ts'
import type { BrowserRemoteProvider, GitRemoteInfo } from '#/shared/git-types.ts'

const gitMock = vi.hoisted(() => vi.fn())

vi.mock('#/system/git/git-exec.ts', async () => {
  const actual = await vi.importActual<typeof import('#/system/git/git-exec.ts')>('#/system/git/git-exec.ts')
  return {
    ...actual,
    git: vi.fn((cwd: string, args: string[], options?: unknown) => gitMock(cwd, args, options)),
  }
})

function remote(name: string, fetchUrl = `git@github.com:acme/${name}.git`): GitRemoteInfo {
  return { name, fetchUrl, pushUrl: fetchUrl }
}

function browserRemote(url: string, provider: BrowserRemoteProvider) {
  return { url, provider }
}

describe('getBrowserRepoUrl', () => {
  test('returns the branch URL on the remote when a branch is provided', async () => {
    gitMock.mockImplementation(async (_cwd: string, args: string[]) => {
      if (args[0] === 'remote' && args[1] === '-v') {
        return 'origin\tgit@github.com:acme/project.git (fetch)\norigin\tgit@github.com:acme/project.git (push)'
      }
      if (args[0] === 'config' && args[1] === '--get' && args[2] === 'branch.feature/test.remote') return 'origin'
      if (args[0] === 'config' && args[1] === '--get' && args[2] === 'branch.feature/test.merge') {
        return 'refs/heads/feature/test'
      }
      throw new Error(`Unexpected git call: ${args.join(' ')}`)
    })

    await expect(getBrowserRepoUrl('/tmp/repo', { type: 'branch', branch: 'feature/test' })).resolves.toBe(
      'https://github.com/acme/project/tree/feature/test',
    )
  })

  test('returns the repo URL when no branch is provided', async () => {
    gitMock.mockImplementation(async (_cwd: string, args: string[]) => {
      if (args[0] === 'remote' && args[1] === '-v') {
        return 'origin\tgit@github.com:acme/project.git (fetch)\norigin\tgit@github.com:acme/project.git (push)'
      }
      throw new Error(`Unexpected git call: ${args.join(' ')}`)
    })

    await expect(getBrowserRepoUrl('/tmp/repo', { type: 'root' })).resolves.toBe('https://github.com/acme/project')
  })

  test('returns the commit URL when a commit target is provided', async () => {
    gitMock.mockImplementation(async (_cwd: string, args: string[]) => {
      if (args[0] === 'remote' && args[1] === '-v') {
        return 'origin\tgit@github.com:acme/project.git (fetch)\norigin\tgit@github.com:acme/project.git (push)'
      }
      throw new Error(`Unexpected git call: ${args.join(' ')}`)
    })

    await expect(getBrowserRepoUrl('/tmp/repo', { type: 'commit', hash: 'abcdef1' })).resolves.toBe(
      'https://github.com/acme/project/commit/abcdef1',
    )
  })

  test('returns the GitLab branch URL when the remote is GitLab', async () => {
    gitMock.mockImplementation(async (_cwd: string, args: string[]) => {
      if (args[0] === 'remote' && args[1] === '-v') {
        return 'origin\tgit@gitlab.com:acme/project.git (fetch)\norigin\tgit@gitlab.com:acme/project.git (push)'
      }
      if (args[0] === 'config' && args[1] === '--get' && args[2] === 'branch.feature/test.remote') return 'origin'
      if (args[0] === 'config' && args[1] === '--get' && args[2] === 'branch.feature/test.merge') {
        return 'refs/heads/feature/test'
      }
      throw new Error(`Unexpected git call: ${args.join(' ')}`)
    })

    await expect(getBrowserRepoUrl('/tmp/repo', { type: 'branch', branch: 'feature/test' })).resolves.toBe(
      'https://gitlab.com/acme/project/-/tree/feature/test',
    )
  })

  test('honors an explicit remote hint for branch targets', async () => {
    // Upstream chip use case: caller knows the remote (e.g. `origin`) and
    // the branch (e.g. `main`) from the tracking ref `origin/main`. The
    // helper should resolve that exact remote instead of consulting the
    // local branch's tracking config.
    gitMock.mockImplementation(async (_cwd: string, args: string[]) => {
      if (args[0] === 'remote' && args[1] === '-v') {
        return (
          'origin\tgit@github.com:acme/project.git (fetch)\n' +
          'origin\tgit@github.com:acme/project.git (push)\n' +
          'upstream\tgit@gitlab.com:acme/mirror.git (fetch)\n' +
          'upstream\tgit@gitlab.com:acme/mirror.git (push)'
        )
      }
      throw new Error(`Unexpected git call: ${args.join(' ')}`)
    })

    // `upstream` would be the preferred remote if we asked it to guess,
    // but the explicit hint forces `origin` (GitHub) instead.
    await expect(getBrowserRepoUrl('/tmp/repo', { type: 'branch', branch: 'main', remote: 'origin' })).resolves.toBe(
      'https://github.com/acme/project/tree/main',
    )
    await expect(getBrowserRepoUrl('/tmp/repo', { type: 'branch', branch: 'main', remote: 'upstream' })).resolves.toBe(
      'https://gitlab.com/acme/mirror/-/tree/main',
    )
  })

  test('returns null when the explicit remote does not exist', async () => {
    gitMock.mockImplementation(async (_cwd: string, args: string[]) => {
      if (args[0] === 'remote' && args[1] === '-v') {
        return 'origin\tgit@github.com:acme/project.git (fetch)\norigin\tgit@github.com:acme/project.git (push)'
      }
      throw new Error(`Unexpected git call: ${args.join(' ')}`)
    })

    await expect(
      getBrowserRepoUrl('/tmp/repo', { type: 'branch', branch: 'main', remote: 'nonexistent' }),
    ).resolves.toBeNull()
  })
})

describe('commitUrlForBrowserRemote', () => {
  test('returns GitHub and GitLab commit URLs', () => {
    expect(commitUrlForBrowserRemote(browserRemote('https://github.com/acme/project', 'github'), 'abcdef1')).toBe(
      'https://github.com/acme/project/commit/abcdef1',
    )
    expect(commitUrlForBrowserRemote(browserRemote('https://gitlab.com/acme/project', 'gitlab'), 'abcdef1')).toBe(
      'https://gitlab.com/acme/project/-/commit/abcdef1',
    )
  })

  test('returns null for unsupported providers and invalid hashes', () => {
    expect(
      commitUrlForBrowserRemote(browserRemote('https://example.com/acme/project', 'external'), 'abcdef1'),
    ).toBeNull()
    expect(
      commitUrlForBrowserRemote(browserRemote('https://github.com/acme/project', 'github'), 'not-a-hash'),
    ).toBeNull()
  })
})

describe('branchUrlForBrowserRemote', () => {
  test('returns null when the remote is null', () => {
    expect(branchUrlForBrowserRemote(null, 'main')).toBeNull()
  })

  test('returns the GitHub branch URL', () => {
    expect(branchUrlForBrowserRemote(browserRemote('https://github.com/acme/project', 'github'), 'main')).toBe(
      'https://github.com/acme/project/tree/main',
    )
  })

  test('encodes each GitHub branch path segment individually', () => {
    expect(
      branchUrlForBrowserRemote(browserRemote('https://github.com/acme/project', 'github'), 'feature/with space'),
    ).toBe('https://github.com/acme/project/tree/feature/with%20space')
  })

  test('returns the GitLab branch URL', () => {
    expect(branchUrlForBrowserRemote(browserRemote('https://gitlab.com/acme/project', 'gitlab'), 'feature/test')).toBe(
      'https://gitlab.com/acme/project/-/tree/feature/test',
    )
  })

  test('returns null for unsupported providers', () => {
    expect(
      branchUrlForBrowserRemote(browserRemote('https://bitbucket.org/acme/project', 'external'), 'main'),
    ).toBeNull()
  })
})

describe('getRepoUrlForRemotes', () => {
  test('returns the branch URL for the preferred remote', () => {
    expect(
      getRepoUrlForRemotes([remote('origin', 'git@github.com:acme/project.git')], {
        type: 'branch',
        branch: 'feature/test',
      }),
    ).toBe('https://github.com/acme/project/tree/feature/test')
  })

  test('prefers the configured upstream remote when present', () => {
    expect(
      getRepoUrlForRemotes(
        [remote('origin', 'git@github.com:acme/origin.git'), remote('fork', 'git@github.com:acme/fork.git')],
        { type: 'branch', branch: 'topic' },
        { remote: 'fork', branch: 'topic' },
      ),
    ).toBe('https://github.com/acme/fork/tree/topic')
  })

  test('returns null when no remotes are configured', () => {
    expect(getRepoUrlForRemotes([], { type: 'branch', branch: 'main' })).toBeNull()
  })
})

describe('resolvePushTargetForRemotes', () => {
  const origin = remote('origin')
  const fork = remote('fork')

  test('prefers an existing upstream remote and branch', () => {
    expect(
      resolvePushTargetForRemotes([origin, fork], { remote: 'fork', branch: 'topic/feature-test' }, 'feature/test'),
    ).toEqual({
      remote: 'fork',
      branch: 'topic/feature-test',
      setUpstream: false,
    })
  })

  test('falls back to origin and sets upstream when no upstream is configured', () => {
    expect(resolvePushTargetForRemotes([origin, fork], null, 'feature/test')).toEqual({
      remote: 'origin',
      branch: 'feature/test',
      setUpstream: true,
    })
  })

  test('falls back to the sole remote when origin is absent', () => {
    expect(resolvePushTargetForRemotes([fork], null, 'feature/test')).toEqual({
      remote: 'fork',
      branch: 'feature/test',
      setUpstream: true,
    })
  })

  test('reports an ambiguous remote when multiple remotes exist without origin or upstream', () => {
    expect(resolvePushTargetForRemotes([fork, remote('backup')], null, 'feature/test')).toEqual({
      ok: false,
      message: 'error.push-ambiguous-remote',
    })
  })

  test('reports no remote when none are configured', () => {
    expect(resolvePushTargetForRemotes([], null, 'feature/test')).toEqual({
      ok: false,
      message: 'error.push-no-remote',
    })
  })

  test('falls back when the configured upstream remote no longer exists', () => {
    expect(
      resolvePushTargetForRemotes([origin], { remote: 'fork', branch: 'topic/feature-test' }, 'feature/test'),
    ).toEqual({
      remote: 'origin',
      branch: 'feature/test',
      setUpstream: true,
    })
  })
})

describe('resolveFetchRemoteForRemotes', () => {
  const origin = remote('origin')
  const fork = remote('fork')

  test('prefers the upstream remote when present', () => {
    expect(resolveFetchRemoteForRemotes([origin, fork], { remote: 'fork', branch: 'feature/test' })).toBe('fork')
  })

  test('falls back to origin when upstream is absent', () => {
    expect(resolveFetchRemoteForRemotes([origin, fork], null)).toBe('origin')
  })

  test('falls back to the sole remote when origin is absent', () => {
    expect(resolveFetchRemoteForRemotes([fork], null)).toBe('fork')
  })

  test('returns null when no remotes exist', () => {
    expect(resolveFetchRemoteForRemotes([], null)).toBeNull()
  })
})

describe('fetchAll', () => {
  test('returns an error when remote metadata cannot be read', async () => {
    gitMock.mockImplementation(async (_cwd: string, args: string[]) => {
      if (args[0] === 'symbolic-ref') return 'main'
      if (args[0] === 'remote' && args[1] === '-v') throw new Error('failed to read remotes')
      if (args[0] === 'config') throw new Error('no upstream')
      throw new Error(`Unexpected git call: ${args.join(' ')}`)
    })

    await expect(fetchAll('/tmp/repo')).resolves.toEqual({ ok: false, message: 'failed to read remotes' })
  })
})
