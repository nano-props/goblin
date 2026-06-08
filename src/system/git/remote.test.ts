import { describe, expect, test, vi } from 'vitest'
import { getBrowserRemoteUrl, resolveFetchRemoteForRemotes, resolvePushTargetForRemotes } from '#/system/git/remote.ts'
import type { GitRemoteInfo } from '#/shared/git-types.ts'

const gitMock = vi.hoisted(() => vi.fn())

vi.mock('#/system/git/helper.ts', async () => {
  const actual = await vi.importActual<typeof import('#/system/git/helper.ts')>('#/system/git/helper.ts')
  return {
    ...actual,
    git: vi.fn((cwd: string, args: string[], options?: unknown) => gitMock(cwd, args, options)),
  }
})

describe('getBrowserRemoteUrl', () => {
  test('returns a branch external target URL when a branch is provided', async () => {
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
      'https://github.com/acme/project/pull/new/feature/test',
    )
  })
})

describe('resolvePushTargetForRemotes', () => {
  const origin = remote('origin')
  const fork = remote('fork')

  test('prefers an existing upstream remote and branch', () => {
    expect(resolvePushTargetForRemotes([origin, fork], { remote: 'fork', branch: 'topic/feature-test' }, 'feature/test')).toEqual({
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
    expect(resolvePushTargetForRemotes([origin], { remote: 'fork', branch: 'topic/feature-test' }, 'feature/test')).toEqual({
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

function remote(name: string): GitRemoteInfo {
  return {
    name,
    fetchUrl: `git@github.com:acme/${name}.git`,
    pushUrl: `git@github.com:acme/${name}.git`,
  }
}
