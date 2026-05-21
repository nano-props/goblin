import { afterEach, describe, expect, test } from 'bun:test'
import { execaSync } from 'execa'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pullBranch } from '#/main/git/remote.ts'

let tmp: string | null = null

function git(cwd: string, ...args: string[]): string {
  return execaSync('git', args, { cwd }).stdout.trim()
}

function initRepo(): { repo: string; remote: string } {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'gbl-remote-test-'))
  const remote = path.join(tmp, 'remote.git')
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
  })

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
  })

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
  })
})
