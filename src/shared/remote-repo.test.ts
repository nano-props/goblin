import { describe, expect, test } from 'vitest'
import {
  isRemoteRepoTarget,
  normalizeRemoteRepoRef,
  normalizeRepoSessionEntry,
  normalizeRemoteTarget,
  remoteRepoRefFromTarget,
  remoteRepoSessionEntry,
  sameRepoSessionEntry,
} from '#/shared/remote-repo.ts'

describe('remote repository normalization', () => {
  test('compares complete persisted repo entry identity', () => {
    const entry = remoteRepoSessionEntry({
      id: 'goblin+ssh://host/repo',
      alias: 'host',
      remotePath: '/repo',
      displayName: 'host:repo',
    })
    expect(sameRepoSessionEntry(entry, { ...entry, ref: { ...entry.ref } })).toBe(true)
    expect(sameRepoSessionEntry(entry, { ...entry, ref: { ...entry.ref, displayName: 'host:renamed' } })).toBe(false)
    expect(sameRepoSessionEntry({ kind: 'local', id: '/repo' }, { kind: 'local', id: '/repo' })).toBe(true)
    expect(sameRepoSessionEntry(null, entry)).toBe(false)
  })

  test('rejects legacy, raw-path, and mismatched persisted identities without repairing them', () => {
    expect(normalizeRepoSessionEntry({ kind: 'local', id: '/repo' })).toBeNull()
    expect(
      normalizeRepoSessionEntry({
        kind: 'remote',
        id: 'goblin+ssh://other/srv/repo',
        ref: { alias: 'prod', remotePath: '/srv/repo', displayName: 'prod:repo' },
      }),
    ).toBeNull()
    expect(
      normalizeRepoSessionEntry({
        kind: 'remote',
        id: 'goblin+ssh://prod/srv/repo',
        target: { alias: 'prod', remotePath: '/srv/repo' },
      }),
    ).toBeNull()
  })

  test('derives ref display names from the normalized remote path', () => {
    expect(
      normalizeRemoteRepoRef({
        alias: 'prod',
        remotePath: '/home/alice/service',
        displayName: 'prod:/',
      }),
    ).toEqual({
      id: 'goblin+ssh://prod/home/alice/service',
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
      id: 'goblin+ssh://prod/home/alice/service',
      remotePath: '/home/alice/service',
      displayName: 'prod:service',
    })
  })

  test('normalizes persisted remote session entries before reuse', () => {
    expect(
      remoteRepoSessionEntry({
        id: 'goblin+ssh://prod/',
        alias: 'prod',
        remotePath: '/srv/repo',
        displayName: 'prod:/',
      }),
    ).toEqual({
      kind: 'remote',
      id: 'goblin+ssh://prod/srv/repo',
      ref: {
        id: 'goblin+ssh://prod/srv/repo',
        alias: 'prod',
        remotePath: '/srv/repo',
        displayName: 'prod:repo',
      },
    })
  })

  test('treats display names as canonical target data', () => {
    const target = {
      id: 'goblin+ssh://prod/srv/repo',
      alias: 'prod',
      host: 'example.test',
      user: 'alice',
      port: 22,
      remotePath: '/srv/repo',
      displayName: 'prod:/',
    }

    expect(isRemoteRepoTarget(target)).toBe(false)
    expect(remoteRepoRefFromTarget({ ...target, displayName: 'prod:repo' })).toEqual({
      id: 'goblin+ssh://prod/srv/repo',
      alias: 'prod',
      remotePath: '/srv/repo',
      displayName: 'prod:repo',
    })
  })
})
