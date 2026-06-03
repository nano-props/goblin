import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { execaSync } from 'execa'
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  fetchAll,
  getBrowserRemoteUrlForRemotes,
  getNewPullRequestUrlForRemotes,
  parseRemoteVerbose,
  repoRemoteInfoForRemotes,
} from '#/system/git/remote.ts'

let templateBase: string | null = null
let tmp: string | null = null

function git(cwd: string, ...args: string[]): string {
  return execaSync('git', args, { cwd }).stdout.trim()
}

beforeAll(() => {
  templateBase = mkdtempSync(path.join(os.tmpdir(), 'gbl-remote-template-'))
  const remote = path.join(templateBase, 'remote.git')
  const seed = path.join(templateBase, 'seed')
  const repo = path.join(templateBase, 'repo')
  execaSync('git', ['init', '--bare', remote], { stdio: 'ignore' })
  execaSync('git', ['init', seed], { stdio: 'ignore' })
  git(seed, 'config', 'user.email', 'test@example.com')
  git(seed, 'config', 'user.name', 'Test User')
  writeFileSync(path.join(seed, 'README.md'), 'hello\n')
  git(seed, 'add', 'README.md')
  git(seed, 'commit', '-m', 'initial')
  git(seed, 'push', remote, 'HEAD:main')
  execaSync('git', ['clone', '-b', 'main', remote, repo], { stdio: 'ignore' })
  git(repo, 'config', 'user.email', 'test@example.com')
  git(repo, 'config', 'user.name', 'Test User')
})

afterAll(() => {
  if (templateBase) rmSync(templateBase, { recursive: true, force: true })
  templateBase = null
})

function initRepo(remoteDirName = 'remote.git'): { repo: string; remote: string } {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'gbl-remote-test-'))
  cpSync(templateBase!, tmp, { recursive: true })
  const remote = path.join(tmp, remoteDirName)
  const repo = path.join(tmp, 'repo')
  git(repo, 'remote', 'set-url', 'origin', remote)
  return { repo, remote }
}

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true })
  tmp = null
  vi.resetModules()
  vi.doUnmock('#/system/git/helper.ts')
  vi.doUnmock('#/system/git/branches.ts')
})

describe('fetchAll', () => {
  test('treats repositories without remotes as a local-only success', async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'gbl-remote-test-'))
    const repo = path.join(tmp, 'repo')
    execaSync('git', ['init', repo], { stdio: 'ignore' })

    const result = await fetchAll(repo)

    expect(result).toEqual({ ok: true, message: '' })
  })

  test('prunes stale remote-tracking refs during fetches', async () => {
    const { repo, remote } = initRepo()
    const seed = path.join(tmp!, 'seed')
    git(seed, 'switch', '-c', 'feature/stale-ref')
    writeFileSync(path.join(seed, 'stale.txt'), 'stale\n')
    git(seed, 'add', 'stale.txt')
    git(seed, 'commit', '-m', 'stale branch')
    git(seed, 'push', remote, 'HEAD:feature/stale-ref')
    git(repo, 'fetch', 'origin')
    expect(git(repo, 'show-ref', '--verify', 'refs/remotes/origin/feature/stale-ref')).toContain('refs/remotes/origin/feature/stale-ref')

    git(seed, 'push', remote, '--delete', 'feature/stale-ref')

    const result = await fetchAll(repo)

    expect(result.ok).toBe(true)
    expect(() => git(repo, 'show-ref', '--verify', 'refs/remotes/origin/feature/stale-ref')).toThrow()
  }, 15000)

  test('fetches only the preferred remote for the current branch', async () => {
    const remoteVerbose = [
      'origin\t/tmp/origin.git (fetch)',
      'origin\t/tmp/origin.git (push)',
      'upstream\t/tmp/upstream.git (fetch)',
      'upstream\t/tmp/upstream.git (push)',
    ].join('\n')
    const { mod, gitResultWithOptionsMock } = await loadRemoteModuleWithMocks({
      currentBranch: 'feature',
      gitValues: [remoteVerbose, 'upstream', 'refs/heads/main'],
    })

    const result = await mod.fetchAll('/tmp/repo')

    expect(result.ok).toBe(true)
    expect(gitResultWithOptionsMock).toHaveBeenCalledWith(
      '/tmp/repo',
      { timeoutMs: 90_000, signal: undefined },
      'fetch',
      '--prune',
      '--',
      'upstream',
    )
  })
})

describe('remote metadata helpers', () => {
  test('parses fetch and push remotes from git remote -v output, including spaces in paths', () => {
    expect(
      parseRemoteVerbose(
        [
          'origin\t/tmp/remote with space.git (fetch)',
          'origin\tgit@github.com:nano-props/goblin.git (push)',
          'upstream\thttps://github.com/acme/repo.git (fetch)',
          'upstream\thttps://github.com/acme/repo.git (push)',
        ].join('\n'),
      ),
    ).toEqual([
      {
        name: 'origin',
        fetchUrl: '/tmp/remote with space.git',
        pushUrl: 'git@github.com:nano-props/goblin.git',
      },
      {
        name: 'upstream',
        fetchUrl: 'https://github.com/acme/repo.git',
        pushUrl: 'https://github.com/acme/repo.git',
      },
    ])
  })

  test('reports remote capability for repositories without remotes', () => {
    expect(repoRemoteInfoForRemotes([])).toEqual({
      remotes: [],
      hasRemotes: false,
      hasBrowserRemote: false,
      browserRemoteProvider: undefined,
      remoteProviders: {},
      hasGitHubRemote: false,
    })
  })

  test('captures separate fetch and push URLs for a remote', () => {
    expect(
      repoRemoteInfoForRemotes([
        {
          name: 'origin',
          fetchUrl: 'https://github.com/nano-props/goblin.git',
          pushUrl: 'git@github.com:nano-props/goblin.git',
        },
      ]),
    ).toMatchObject({
      remotes: [
        {
          name: 'origin',
          fetchUrl: 'https://github.com/nano-props/goblin.git',
          pushUrl: 'git@github.com:nano-props/goblin.git',
        },
      ],
      hasRemotes: true,
      hasBrowserRemote: true,
      browserRemoteProvider: 'github',
      remoteProviders: { origin: 'github' },
      hasGitHubRemote: true,
    })
  })

  test('resolves browser and new MR URLs from GitLab remotes', () => {
    const remotes = [{ name: 'origin', fetchUrl: 'git@gitlab.com:acme/platform/repo.git', pushUrl: 'git@gitlab.com:acme/platform/repo.git' }]

    expect(getBrowserRemoteUrlForRemotes(remotes)).toBe('https://gitlab.com/acme/platform/repo')
    expect(getNewPullRequestUrlForRemotes(remotes, 'feature/gitlab')).toBe(
      'https://gitlab.com/acme/platform/repo/-/merge_requests/new?merge_request%5Bsource_branch%5D=feature%2Fgitlab',
    )
    expect(repoRemoteInfoForRemotes(remotes)).toMatchObject({
      hasRemotes: true,
      hasBrowserRemote: true,
      browserRemoteProvider: 'gitlab',
      remoteProviders: { origin: 'gitlab' },
      hasGitHubRemote: false,
    })
  })

  test('treats unknown web remotes as external browser remotes', () => {
    const remotes = [{ name: 'origin', fetchUrl: 'https://code.example.com/acme/repo.git', pushUrl: 'https://code.example.com/acme/repo.git' }]

    expect(getBrowserRemoteUrlForRemotes(remotes)).toBe('https://code.example.com/acme/repo')
    expect(getNewPullRequestUrlForRemotes(remotes, 'feature/external')).toBeNull()
    expect(repoRemoteInfoForRemotes(remotes)).toMatchObject({
      hasRemotes: true,
      hasBrowserRemote: true,
      browserRemoteProvider: 'external',
      remoteProviders: { origin: 'external' },
      hasGitHubRemote: false,
    })
  })

  test('prefers the branch upstream GitHub remote over origin for browser URLs', () => {
    const remotes = [
      { name: 'origin', fetchUrl: 'git@github.com:me/fork.git', pushUrl: 'git@github.com:me/fork.git' },
      { name: 'upstream', fetchUrl: 'git@github.com:acme/repo.git', pushUrl: 'git@github.com:acme/repo.git' },
    ]
    const upstream = { remote: 'upstream', branch: 'main' }

    expect(getBrowserRemoteUrlForRemotes(remotes, upstream)).toBe('https://github.com/acme/repo')
    expect(getNewPullRequestUrlForRemotes(remotes, 'feature', upstream)).toBe('https://github.com/acme/repo/pull/new/feature')
  })

  test('falls back to origin when the branch upstream is not a browser remote', () => {
    const remotes = [
      { name: 'origin', fetchUrl: 'git@github.com:me/fork.git', pushUrl: 'git@github.com:me/fork.git' },
      { name: 'local', fetchUrl: '/tmp/local.git', pushUrl: '/tmp/local.git' },
    ]

    expect(getBrowserRemoteUrlForRemotes(remotes, { remote: 'local', branch: 'main' })).toBe('https://github.com/me/fork')
  })
})

async function loadRemoteModuleWithMocks(options?: {
  gitValues?: Array<string | Error>
  currentBranch?: string
  gitResult?: { ok: boolean; message: string }
}) {
  const gitMock = vi.fn()
  for (const value of options?.gitValues ?? []) {
    if (value instanceof Error) gitMock.mockRejectedValueOnce(value)
    else gitMock.mockResolvedValueOnce(value)
  }
  const gitResultWithOptionsMock = vi.fn().mockResolvedValue(options?.gitResult ?? { ok: true, message: '' })
  const getCurrentBranchMock = vi.fn().mockResolvedValue(options?.currentBranch ?? 'main')

  vi.doMock('#/system/git/helper.ts', async () => {
    const actual = await vi.importActual<typeof import('#/system/git/helper.ts')>('#/system/git/helper.ts')
    return {
      ...actual,
      git: vi.fn((cwd: string, args: string[], opts?: unknown) => gitMock(cwd, args, opts)),
      gitResultWithOptions: vi.fn((cwd: string, opts: unknown, ...args: string[]) =>
        gitResultWithOptionsMock(cwd, opts, ...args)
      ),
    }
  })
  vi.doMock('#/system/git/branches.ts', async () => {
    const actual = await vi.importActual<typeof import('#/system/git/branches.ts')>('#/system/git/branches.ts')
    return {
      ...actual,
      getCurrentBranch: vi.fn((cwd: string, opts?: unknown) => getCurrentBranchMock(cwd, opts)),
    }
  })

  const mod = await import('#/system/git/remote.ts')
  return { mod, gitMock, gitResultWithOptionsMock, getCurrentBranchMock }
}

describe('pullBranch', () => {
  test('builds a fetch for dash-named upstream remotes', async () => {
    const { mod, gitResultWithOptionsMock } = await loadRemoteModuleWithMocks({
      currentBranch: 'other',
      gitValues: ['-foo', 'refs/heads/main', '/tmp/remote.git'],
    })

    const result = await mod.pullBranch('/tmp/repo', 'feature')

    expect(result.ok).toBe(true)
    expect(gitResultWithOptionsMock).toHaveBeenCalledWith(
      '/tmp/repo',
      { timeoutMs: 90_000, signal: undefined },
      'fetch',
      '--',
      '-foo',
      'main:feature',
    )
  })

  test('uses local upstream branches without checking remotes', async () => {
    const { mod, gitMock, gitResultWithOptionsMock } = await loadRemoteModuleWithMocks({
      currentBranch: 'main',
      gitValues: ['.', 'refs/heads/base'],
    })

    const result = await mod.pullBranch('/tmp/repo', 'feature')

    expect(result.ok).toBe(true)
    expect(gitResultWithOptionsMock).toHaveBeenCalledWith(
      '/tmp/repo',
      { timeoutMs: 90_000, signal: undefined },
      'fetch',
      '--',
      '.',
      'base:feature',
    )
    expect(gitMock).toHaveBeenCalledTimes(2)
  })

  test('returns an i18n error when the upstream remote is missing', async () => {
    const { mod, gitResultWithOptionsMock } = await loadRemoteModuleWithMocks({
      currentBranch: 'main',
      gitValues: ['missing', 'refs/heads/main', new Error('missing remote')],
    })

    await expect(mod.pullBranch('/tmp/repo', 'feature')).resolves.toEqual({ ok: false, message: 'error.pull-no-remote' })
    expect(gitResultWithOptionsMock).not.toHaveBeenCalled()
  })
})

describe('pushBranch', () => {
  test('falls back to origin for branches without a pushable upstream', async () => {
    const originRemoteVerbose = 'origin\tgit@github.com:acme/repo.git (fetch)\norigin\tgit@github.com:acme/repo.git (push)\n'
    const missing = new Error('missing')
    const { mod, gitResultWithOptionsMock } = await loadRemoteModuleWithMocks({
      gitValues: [originRemoteVerbose, missing, missing, originRemoteVerbose, '.', 'refs/heads/main'],
    })

    const first = await mod.pushBranch('/tmp/repo', 'feature-no-upstream')
    const second = await mod.pushBranch('/tmp/repo', 'feature-dot-upstream')

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(gitResultWithOptionsMock).toHaveBeenNthCalledWith(
      1,
      '/tmp/repo',
      { timeoutMs: 90_000, signal: undefined },
      'push',
      '-u',
      '--',
      'origin',
      'feature-no-upstream:feature-no-upstream',
    )
    expect(gitResultWithOptionsMock).toHaveBeenNthCalledWith(
      2,
      '/tmp/repo',
      { timeoutMs: 90_000, signal: undefined },
      'push',
      '-u',
      '--',
      'origin',
      'feature-dot-upstream:feature-dot-upstream',
    )
  })

  test('pushes to configured dash-named upstream remotes', async () => {
    const dashRemoteVerbose = '-foo\t/tmp/remote.git (fetch)\n-foo\t/tmp/remote.git (push)\n'
    const { mod, gitResultWithOptionsMock } = await loadRemoteModuleWithMocks({
      gitValues: [dashRemoteVerbose, '-foo', 'refs/heads/review/feature'],
    })

    const result = await mod.pushBranch('/tmp/repo', 'feature')

    expect(result.ok).toBe(true)
    expect(gitResultWithOptionsMock).toHaveBeenCalledWith(
      '/tmp/repo',
      { timeoutMs: 90_000, signal: undefined },
      'push',
      '--',
      '-foo',
      'feature:review/feature',
    )
  })

  test('returns clear errors for missing and ambiguous remotes', async () => {
    const missing = new Error('missing')
    const ambiguousRemoteVerbose = [
      'upstream\t/tmp/upstream.git (fetch)',
      'upstream\t/tmp/upstream.git (push)',
      'fork\t/tmp/fork.git (fetch)',
      'fork\t/tmp/fork.git (push)',
    ].join('\n')
    const { mod } = await loadRemoteModuleWithMocks({
      gitValues: ['', missing, missing, ambiguousRemoteVerbose, missing, missing],
    })

    await expect(mod.pushBranch('/tmp/repo', 'main')).resolves.toEqual({ ok: false, message: 'error.push-no-remote' })
    await expect(mod.pushBranch('/tmp/repo', 'feature')).resolves.toEqual({
      ok: false,
      message: 'error.push-ambiguous-remote',
    })
  })
})
