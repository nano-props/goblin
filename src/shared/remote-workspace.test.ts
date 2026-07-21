import { describe, expect, test } from 'vitest'
import {
  isRemoteWorkspaceTarget,
  isRemoteWorkspaceFailureReason,
  normalizeRemoteWorkspaceRef,
  normalizeWorkspaceSessionEntry,
  normalizeRemoteTarget,
  remoteWorkspaceRefFromTarget,
  remoteWorkspaceSessionEntry,
  sameWorkspaceSessionEntry,
} from '#/shared/remote-workspace.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

describe('remote workspace normalization', () => {
  test('keeps Git probe outcomes out of lifecycle failure reasons', () => {
    expect(isRemoteWorkspaceFailureReason('not-a-repo')).toBe(false)
    expect(isRemoteWorkspaceFailureReason('git-missing')).toBe(false)
  })

  test('compares persisted workspace identity by canonical ID', () => {
    const entry = remoteWorkspaceSessionEntry({
      id: workspaceIdForTest('goblin+ssh://host/repo'),
      alias: 'host',
      remotePath: '/repo',
      displayName: 'host:repo',
    })
    expect(sameWorkspaceSessionEntry(entry, { ...entry })).toBe(true)
    expect(
      sameWorkspaceSessionEntry(
        { id: workspaceIdForTest('goblin+file:///repo') },
        { id: workspaceIdForTest('goblin+file:///repo') },
      ),
    ).toBe(true)
    expect(sameWorkspaceSessionEntry(null, entry)).toBe(false)
  })

  test('rejects legacy, raw-path, and mismatched persisted identities without repairing them', () => {
    expect(normalizeWorkspaceSessionEntry({ kind: 'local', id: '/repo' })).toBeNull()
    expect(
      normalizeWorkspaceSessionEntry({
        kind: 'remote',
        id: 'goblin+ssh://other/srv/repo',
        ref: { alias: 'prod', remotePath: '/srv/repo', displayName: 'prod:repo' },
      }),
    ).toBeNull()
    expect(
      normalizeWorkspaceSessionEntry({
        kind: 'remote',
        id: 'goblin+ssh://prod/srv/repo',
        target: { alias: 'prod', remotePath: '/srv/repo' },
      }),
    ).toBeNull()
  })

  test('accepts bounded cross-platform identities and rejects oversized durable entries', () => {
    expect(normalizeWorkspaceSessionEntry({ id: 'goblin+file:///repo' })).toEqual({ id: 'goblin+file:///repo' })
    expect(normalizeWorkspaceSessionEntry({ id: 'goblin+file:///C:/repo' })).toEqual({
      id: 'goblin+file:///C:/repo',
    })
    expect(normalizeWorkspaceSessionEntry({ id: `goblin+file:///${'a'.repeat(4096)}` })).toBeNull()
  })

  test('derives ref display names from the normalized remote path', () => {
    expect(
      normalizeRemoteWorkspaceRef({
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

  test('constructs a canonical ID-only session entry from a remote reference', () => {
    expect(
      remoteWorkspaceSessionEntry({
        id: workspaceIdForTest('goblin+ssh://prod/'),
        alias: 'prod',
        remotePath: '/srv/repo',
        displayName: 'prod:/',
      }),
    ).toEqual({ id: 'goblin+ssh://prod/srv/repo' })
  })

  test('treats display names as canonical target data', () => {
    const target = {
      id: workspaceIdForTest('goblin+ssh://prod/srv/repo'),
      alias: 'prod',
      host: 'example.test',
      user: 'alice',
      port: 22,
      remotePath: '/srv/repo',
      displayName: 'prod:/',
    }

    expect(isRemoteWorkspaceTarget(target)).toBe(false)
    expect(remoteWorkspaceRefFromTarget({ ...target, displayName: 'prod:repo' })).toEqual({
      id: 'goblin+ssh://prod/srv/repo',
      alias: 'prod',
      remotePath: '/srv/repo',
      displayName: 'prod:repo',
    })
  })
})
