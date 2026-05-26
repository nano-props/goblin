import { afterEach, describe, expect, test } from 'vitest'
import { execaSync } from 'execa'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fetchAll, getBrowserRemoteUrl, getNewPullRequestUrl, getRemoteInfo, pullBranch, pushBranch } from '#/main/git/remote.ts'
import { getGitHubRepoRef } from '#/main/github/graphql.ts'

let tmp: string | null = null

function git(cwd: string, ...args: string[]): string {
  return execaSync('git', args, { cwd }).stdout.trim()
}

function initRepo(remoteDirName = 'remote.git'): { repo: string; remote: string } {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'gbl-remote-test-'))
  const remote = path.join(tmp, remoteDirName)
  const seed = path.join(tmp, 'seed')
  const repo = path.join(tmp, 'repo')
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
  return { repo, remote }
}

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true })
  tmp = null
})

describe('fetchAll', () => {
  test('treats repositories without remotes as a local-only success', async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'gbl-remote-test-'))
    const repo = path.join(tmp, 'repo')
    execaSync('git', ['init', repo], { stdio: 'ignore' })

    const result = await fetchAll(repo)

    expect(result).toEqual({ ok: true, message: '' })
  })

  test('reports remote capability for repositories without remotes', async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'gbl-remote-test-'))
    const repo = path.join(tmp, 'repo')
    execaSync('git', ['init', repo], { stdio: 'ignore' })

    await expect(getRemoteInfo(repo)).resolves.toEqual({
      remotes: [],
      hasRemotes: false,
      hasBrowserRemote: false,
      browserRemoteProvider: undefined,
      remoteProviders: {},
      hasGitHubRemote: false,
    })
  })

  test('fetches when only a non-origin remote is configured', async () => {
    const { repo, remote } = initRepo()
    git(repo, 'remote', 'remove', 'origin')
    git(repo, 'remote', 'add', 'upstream', remote)

    const result = await fetchAll(repo)

    expect(result.ok).toBe(true)
  }, 15000)

  test('fetches when only a dash-named remote is configured', async () => {
    const { repo, remote } = initRepo()
    git(repo, 'remote', 'remove', 'origin')
    git(repo, 'remote', 'add', '--', '-foo', remote)

    const result = await fetchAll(repo)

    expect(result.ok).toBe(true)
  }, 15000)

  test('fetches when a local remote path contains spaces', async () => {
    const { repo, remote } = initRepo('remote with space.git')

    await expect(getRemoteInfo(repo)).resolves.toEqual({
      remotes: [{ name: 'origin', url: remote }],
      hasRemotes: true,
      hasBrowserRemote: false,
      browserRemoteProvider: undefined,
      remoteProviders: {},
      hasGitHubRemote: false,
    })
    const result = await fetchAll(repo)

    expect(result.ok).toBe(true)
  }, 15000)

  test('resolves browser URLs from non-origin GitHub remotes', async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'gbl-remote-test-'))
    const repo = path.join(tmp, 'repo')
    execaSync('git', ['init', repo], { stdio: 'ignore' })
    git(repo, 'remote', 'add', 'upstream', 'git@github.com:acme/repo.git')

    await expect(getBrowserRemoteUrl(repo)).resolves.toBe('https://github.com/acme/repo')
    await expect(getRemoteInfo(repo)).resolves.toMatchObject({
      hasRemotes: true,
      hasBrowserRemote: true,
      browserRemoteProvider: 'github',
      remoteProviders: { upstream: 'github' },
      hasGitHubRemote: true,
    })
  })

  test('resolves browser and new MR URLs from GitLab remotes', async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'gbl-remote-test-'))
    const repo = path.join(tmp, 'repo')
    execaSync('git', ['init', repo], { stdio: 'ignore' })
    git(repo, 'remote', 'add', 'origin', 'git@gitlab.com:acme/platform/repo.git')

    await expect(getBrowserRemoteUrl(repo)).resolves.toBe('https://gitlab.com/acme/platform/repo')
    await expect(getNewPullRequestUrl(repo, 'feature/gitlab')).resolves.toBe(
      'https://gitlab.com/acme/platform/repo/-/merge_requests/new?merge_request%5Bsource_branch%5D=feature%2Fgitlab',
    )
    await expect(getRemoteInfo(repo)).resolves.toMatchObject({
      hasRemotes: true,
      hasBrowserRemote: true,
      browserRemoteProvider: 'gitlab',
      remoteProviders: { origin: 'gitlab' },
      hasGitHubRemote: false,
    })
    await expect(getGitHubRepoRef(repo)).resolves.toBeNull()
  })

  test('treats unknown web remotes as external browser remotes', async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'gbl-remote-test-'))
    const repo = path.join(tmp, 'repo')
    execaSync('git', ['init', repo], { stdio: 'ignore' })
    git(repo, 'remote', 'add', 'origin', 'https://code.example.com/acme/repo.git')

    await expect(getBrowserRemoteUrl(repo)).resolves.toBe('https://code.example.com/acme/repo')
    await expect(getNewPullRequestUrl(repo, 'feature/external')).resolves.toBeNull()
    await expect(getRemoteInfo(repo)).resolves.toMatchObject({
      hasRemotes: true,
      hasBrowserRemote: true,
      browserRemoteProvider: 'external',
      remoteProviders: { origin: 'external' },
      hasGitHubRemote: false,
    })
    await expect(getGitHubRepoRef(repo)).resolves.toBeNull()
  })

  test('prefers the branch upstream GitHub remote over origin for browser URLs', async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'gbl-remote-test-'))
    const repo = path.join(tmp, 'repo')
    execaSync('git', ['init', repo], { stdio: 'ignore' })
    git(repo, 'remote', 'add', 'origin', 'git@github.com:me/fork.git')
    git(repo, 'remote', 'add', 'upstream', 'git@github.com:acme/repo.git')
    git(repo, 'config', 'branch.feature.remote', 'upstream')
    git(repo, 'config', 'branch.feature.merge', 'refs/heads/main')

    await expect(getBrowserRemoteUrl(repo, { branch: 'feature' })).resolves.toBe('https://github.com/acme/repo')
    await expect(getNewPullRequestUrl(repo, 'feature')).resolves.toBe('https://github.com/acme/repo/pull/new/feature')
    await expect(getGitHubRepoRef(repo, { branch: 'feature' })).resolves.toEqual({
      host: 'github.com',
      owner: 'acme',
      name: 'repo',
    })
  })

  test('falls back to origin when the branch upstream is not a GitHub remote', async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'gbl-remote-test-'))
    const repo = path.join(tmp, 'repo')
    const localRemote = path.join(tmp, 'local.git')
    execaSync('git', ['init', repo], { stdio: 'ignore' })
    execaSync('git', ['init', '--bare', localRemote], { stdio: 'ignore' })
    git(repo, 'remote', 'add', 'origin', 'git@github.com:me/fork.git')
    git(repo, 'remote', 'add', 'local', localRemote)
    git(repo, 'config', 'branch.feature.remote', 'local')
    git(repo, 'config', 'branch.feature.merge', 'refs/heads/main')

    await expect(getBrowserRemoteUrl(repo, { branch: 'feature' })).resolves.toBe('https://github.com/me/fork')
  })
})

describe('pullBranch', () => {
  test('uses upstream remote names that contain slashes', async () => {
    const { repo, remote } = initRepo()
    const initial = git(repo, 'rev-parse', 'HEAD')
    git(repo, 'remote', 'remove', 'origin')
    git(repo, 'remote', 'add', 'foo/bar', remote)
    git(repo, 'fetch', 'foo/bar')
    git(repo, 'switch', '-c', 'feature', initial)
    git(repo, 'config', 'branch.feature.remote', 'foo/bar')
    git(repo, 'config', 'branch.feature.merge', 'refs/heads/main')
    git(repo, 'switch', '-c', 'other', initial)

    const seed = path.join(tmp!, 'seed')
    writeFileSync(path.join(seed, 'README.md'), 'updated\n')
    git(seed, 'commit', '-am', 'update')
    const updated = git(seed, 'rev-parse', 'HEAD')
    git(seed, 'push', remote, 'HEAD:main')

    const result = await pullBranch(repo, 'feature')

    expect(result.ok).toBe(true)
    expect(git(repo, 'rev-parse', 'feature')).toBe(updated)
  }, 15000)

  test('uses upstream remote names that start with dashes', async () => {
    const { repo, remote } = initRepo()
    const initial = git(repo, 'rev-parse', 'HEAD')
    git(repo, 'remote', 'remove', 'origin')
    git(repo, 'remote', 'add', '--', '-foo', remote)
    git(repo, 'fetch', '--', '-foo')
    git(repo, 'switch', '-c', 'feature', initial)
    git(repo, 'config', 'branch.feature.remote', '-foo')
    git(repo, 'config', 'branch.feature.merge', 'refs/heads/main')
    git(repo, 'switch', '-c', 'other', initial)

    const seed = path.join(tmp!, 'seed')
    writeFileSync(path.join(seed, 'README.md'), 'dash remote update\n')
    git(seed, 'commit', '-am', 'dash remote update')
    const updated = git(seed, 'rev-parse', 'HEAD')
    git(seed, 'push', remote, 'HEAD:main')

    const result = await pullBranch(repo, 'feature')

    expect(result.ok).toBe(true)
    expect(git(repo, 'rev-parse', 'feature')).toBe(updated)
  }, 15000)

  test('uses local upstream branches', async () => {
    const { repo } = initRepo()
    const initial = git(repo, 'rev-parse', 'HEAD')
    git(repo, 'switch', '-c', 'base', initial)
    writeFileSync(path.join(repo, 'README.md'), 'base update\n')
    git(repo, 'commit', '-am', 'base update')
    const updated = git(repo, 'rev-parse', 'HEAD')
    git(repo, 'switch', '-c', 'feature', initial)
    git(repo, 'config', 'branch.feature.remote', '.')
    git(repo, 'config', 'branch.feature.merge', 'refs/heads/base')
    git(repo, 'switch', 'main')

    const result = await pullBranch(repo, 'feature')

    expect(result.ok).toBe(true)
    expect(git(repo, 'rev-parse', 'feature')).toBe(updated)
  }, 15000)

  test('returns an i18n error when the upstream remote is missing', async () => {
    const { repo } = initRepo()
    const initial = git(repo, 'rev-parse', 'HEAD')
    git(repo, 'switch', '-c', 'feature', initial)
    git(repo, 'config', 'branch.feature.remote', 'missing')
    git(repo, 'config', 'branch.feature.merge', 'refs/heads/main')
    git(repo, 'switch', 'main')

    await expect(pullBranch(repo, 'feature')).resolves.toEqual({ ok: false, message: 'error.pull-no-remote' })
  }, 15000)
})

describe('pushBranch', () => {
  test('pushes to origin when no upstream is configured', async () => {
    const { repo, remote } = initRepo()
    git(repo, 'switch', '-c', 'feature')
    writeFileSync(path.join(repo, 'README.md'), 'feature update\n')
    git(repo, 'commit', '-am', 'feature update')

    const result = await pushBranch(repo, 'feature')

    expect(result.ok).toBe(true)
    expect(git(repo, 'rev-parse', 'feature')).toBe(git(repo, 'ls-remote', remote, 'refs/heads/feature').split(/\s+/)[0])
    expect(git(repo, 'rev-parse', '--abbrev-ref', 'feature@{u}')).toBe('origin/feature')
  }, 15000)

  test('pushes to the only remote when it is not origin', async () => {
    const { repo, remote } = initRepo()
    git(repo, 'remote', 'remove', 'origin')
    git(repo, 'remote', 'add', 'upstream', remote)
    git(repo, 'switch', '-c', 'feature')
    writeFileSync(path.join(repo, 'README.md'), 'feature update\n')
    git(repo, 'commit', '-am', 'feature update')

    const result = await pushBranch(repo, 'feature')

    expect(result.ok).toBe(true)
    expect(git(repo, 'rev-parse', 'feature')).toBe(git(repo, 'ls-remote', remote, 'refs/heads/feature').split(/\s+/)[0])
    expect(git(repo, 'rev-parse', '--abbrev-ref', 'feature@{u}')).toBe('upstream/feature')
  }, 15000)

  test('pushes to remote names that start with dashes', async () => {
    const { repo, remote } = initRepo()
    git(repo, 'remote', 'remove', 'origin')
    git(repo, 'remote', 'add', '--', '-foo', remote)
    git(repo, 'switch', '-c', 'feature')
    writeFileSync(path.join(repo, 'README.md'), 'feature update\n')
    git(repo, 'commit', '-am', 'feature update')

    const result = await pushBranch(repo, 'feature')

    expect(result.ok).toBe(true)
    expect(git(repo, 'rev-parse', 'feature')).toBe(git(repo, 'ls-remote', remote, 'refs/heads/feature').split(/\s+/)[0])
    expect(git(repo, 'rev-parse', '--abbrev-ref', 'feature@{u}')).toBe('-foo/feature')
  }, 15000)

  test('uses a non-origin upstream remote when configured', async () => {
    const { repo, remote } = initRepo()
    git(repo, 'remote', 'remove', 'origin')
    git(repo, 'remote', 'add', 'upstream', remote)
    git(repo, 'fetch', 'upstream')
    git(repo, 'switch', '-c', 'feature')
    writeFileSync(path.join(repo, 'README.md'), 'feature update\n')
    git(repo, 'commit', '-am', 'feature update')
    git(repo, 'config', 'branch.feature.remote', 'upstream')
    git(repo, 'config', 'branch.feature.merge', 'refs/heads/review/feature')

    const result = await pushBranch(repo, 'feature')

    expect(result.ok).toBe(true)
    expect(git(repo, 'rev-parse', 'feature')).toBe(
      git(repo, 'ls-remote', remote, 'refs/heads/review/feature').split(/\s+/)[0],
    )
  }, 15000)

  test('does not push local upstreams to dot remotes', async () => {
    const { repo, remote } = initRepo()
    git(repo, 'switch', '-c', 'feature')
    writeFileSync(path.join(repo, 'README.md'), 'feature update\n')
    git(repo, 'commit', '-am', 'feature update')
    git(repo, 'config', 'branch.feature.remote', '.')
    git(repo, 'config', 'branch.feature.merge', 'refs/heads/main')

    const result = await pushBranch(repo, 'feature')

    expect(result.ok).toBe(true)
    expect(git(repo, 'rev-parse', 'feature')).toBe(git(repo, 'ls-remote', remote, 'refs/heads/feature').split(/\s+/)[0])
    expect(git(repo, 'rev-parse', '--abbrev-ref', 'feature@{u}')).toBe('origin/feature')
  }, 15000)

  test('returns a clear error when there are no remotes', async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'gbl-remote-test-'))
    const repo = path.join(tmp, 'repo')
    execaSync('git', ['init', repo], { stdio: 'ignore' })
    git(repo, 'config', 'user.email', 'test@example.com')
    git(repo, 'config', 'user.name', 'Test User')
    writeFileSync(path.join(repo, 'README.md'), 'hello\n')
    git(repo, 'add', 'README.md')
    git(repo, 'commit', '-m', 'initial')

    await expect(pushBranch(repo, 'main')).resolves.toEqual({ ok: false, message: 'error.push-no-remote' })
  })

  test('returns a clear error when multiple remotes are ambiguous', async () => {
    const { repo, remote } = initRepo()
    const other = path.join(tmp!, 'other.git')
    execaSync('git', ['init', '--bare', other], { stdio: 'ignore' })
    git(repo, 'remote', 'remove', 'origin')
    git(repo, 'remote', 'add', 'upstream', remote)
    git(repo, 'remote', 'add', 'fork', other)
    git(repo, 'switch', '-c', 'feature')
    writeFileSync(path.join(repo, 'README.md'), 'feature update\n')
    git(repo, 'commit', '-am', 'feature update')

    await expect(pushBranch(repo, 'feature')).resolves.toEqual({
      ok: false,
      message: 'error.push-ambiguous-remote',
    })
  }, 15000)
})
