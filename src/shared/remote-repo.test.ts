import { describe, expect, test } from 'vitest'
import {
  isRemoteRepoTarget,
  normalizeRemoteRepoRef,
  normalizeRemoteTarget,
  remoteRepoRefFromTarget,
  remoteRepoSessionEntry,
} from '#/shared/remote-repo.ts'

describe('remote repository normalization', () => {
  test('derives ref display names from the normalized remote path', () => {
    expect(
      normalizeRemoteRepoRef({
        alias: 'prod',
        remotePath: '/home/alice/service',
        displayName: 'prod:/',
      }),
    ).toEqual({
      id: 'ssh-config://prod/home/alice/service',
      alias: 'prod',
      remotePath: '/home/alice/service',
      displayName: 'prod:service',
    })
  })

  test('canonicalizes stale target display names', () => {
    expect(
      normalizeRemoteTarget({
        alias: 'prod',
        host: 'example.test',
        user: 'alice',
        port: 22,
        remotePath: '/home/alice/service',
        displayName: 'prod:/',
      }),
    ).toMatchObject({
      id: 'ssh-config://prod/home/alice/service',
      remotePath: '/home/alice/service',
      displayName: 'prod:service',
    })
  })

  test('normalizes persisted remote session entries before reuse', () => {
    expect(
      remoteRepoSessionEntry({
        id: 'ssh-config://prod/',
        alias: 'prod',
        remotePath: '/srv/repo',
        displayName: 'prod:/',
      }),
    ).toEqual({
      kind: 'remote',
      id: 'ssh-config://prod/srv/repo',
      ref: {
        id: 'ssh-config://prod/srv/repo',
        alias: 'prod',
        remotePath: '/srv/repo',
        displayName: 'prod:repo',
      },
    })
  })

  test('treats display names as canonical target data', () => {
    const target = {
      id: 'ssh-config://prod/srv/repo',
      alias: 'prod',
      host: 'example.test',
      user: 'alice',
      port: 22,
      remotePath: '/srv/repo',
      displayName: 'prod:/',
    }

    expect(isRemoteRepoTarget(target)).toBe(false)
    expect(remoteRepoRefFromTarget({ ...target, displayName: 'prod:repo' })).toEqual({
      id: 'ssh-config://prod/srv/repo',
      alias: 'prod',
      remotePath: '/srv/repo',
      displayName: 'prod:repo',
    })
  })
})
