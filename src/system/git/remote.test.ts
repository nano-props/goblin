import { describe, expect, test, vi } from 'vitest'
import {
  branchUrlForBrowserRemote,
  getBranchUrlForRemotes,
  getBrowserRemoteUrl,
  resolveFetchRemoteForRemotes,
  resolvePushTargetForRemotes,
} from '#/system/git/remote.ts'
import type { BrowserRemoteProvider, GitRemoteInfo } from '#/shared/git-types.ts'

const gitMock = vi.hoisted(() => vi.fn())

vi.mock('#/system/git/helper.ts', async () => {
  const actual = await vi.importActual<typeof import('#/system/git/helper.ts')>('#/system/git/helper.ts')
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

describe('getBrowserRemoteUrl', () => {
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

    await expect(getBrowserRemoteUrl('/tmp/repo', { branch: 'feature/test' })).resolves.toBe(
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

    await expect(getBrowserRemoteUrl('/tmp/repo')).resolves.toBe('https://github.com/acme/project')
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

    await expect(getBrowserRemoteUrl('/tmp/repo', { branch: 'feature/test' })).resolves.toBe(
      'https://gitlab.com/acme/project/-/tree/feature/test',
    )
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
    expect(branchUrlForBrowserRemote(browserRemote('https://bitbucket.org/acme/project', 'external'), 'main')).toBeNull()
  })
})

describe('getBranchUrlForRemotes', () => {
  test('returns the branch URL for the preferred remote', () => {
    expect(getBranchUrlForRemotes([remote('origin', 'git@github.com:acme/project.git')], 'feature/test')).toBe(
      'https://github.com/acme/project/tree/feature/test',
    )
  })

  test('prefers the configured upstream remote when present', () => {
    expect(
      getBranchUrlForRemotes(
        [remote('origin', 'git@github.com:acme/origin.git'), remote('fork', 'git@github.com:acme/fork.git')],
        'topic',
        { remote: 'fork', branch: 'topic' },
      ),
    ).toBe('https://github.com/acme/fork/tree/topic')
  })

  test('returns null when no remotes are configured', () => {
    expect(getBranchUrlForRemotes([], 'main')).toBeNull()
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
