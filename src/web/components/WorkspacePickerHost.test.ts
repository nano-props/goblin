import { describe, expect, test } from 'vitest'
import { latestRepoSyncTime } from '#/web/stores/repos/sync-time.ts'
import { workspacePickerItemsEqual } from '#/web/components/workspace-picker/summary-equality.ts'
import type { WorkspacePickerItem } from '#/web/components/workspace-picker/types.ts'
import { emptyRepo } from '#/web/stores/repos/repo-state-factory.ts'

describe('workspacePickerItemsEqual', () => {
  test('treats Git capability changes as unequal', () => {
    const item: WorkspacePickerItem = {
      id: 'goblin+file:///tmp/workspace',
      name: 'workspace',
      gitCapability: 'unavailable',
      remoteDetails: [],
      lastSyncedAt: null,
      lifecycle: null,
    }

    expect(workspacePickerItemsEqual([item], [{ ...item, gitCapability: 'available' }])).toBe(false)
  })

  test('treats remote lifecycle target changes as unequal even when repo id stays the same', () => {
    const left: WorkspacePickerItem[] = [
      {
        id: 'goblin+ssh://example/srv%2Frepo',
        name: 'repo',
        gitCapability: 'available',
        remoteDetails: [],
        lastSyncedAt: null,
        lifecycle: {
          kind: 'ready',
          target: {
            id: 'goblin+ssh://example/srv%2Frepo',
            alias: 'example',
            host: 'old-host.internal',
            user: 'old-user',
            port: 22,
            remotePath: '/srv/repo',
            displayName: 'example:repo',
          },
        },
      },
    ]
    const right: WorkspacePickerItem[] = [
      {
        id: 'goblin+ssh://example/srv%2Frepo',
        name: 'repo',
        gitCapability: 'available',
        remoteDetails: [],
        lastSyncedAt: null,
        lifecycle: {
          kind: 'ready',
          target: {
            id: 'goblin+ssh://example/srv%2Frepo',
            alias: 'example',
            host: 'new-host.internal',
            user: 'new-user',
            port: 2222,
            remotePath: '/srv/repo',
            displayName: 'example-renamed:repo',
          },
        },
      },
    ]

    expect(workspacePickerItemsEqual(left, right)).toBe(false)
  })

  test('treats failed lifecycle target locator changes as unequal', () => {
    const target = {
      id: 'goblin+ssh://example/srv%2Frepo',
      alias: 'example',
      host: 'same-host.internal',
      user: 'old-user',
      port: 22,
      remotePath: '/srv/repo',
      displayName: 'example:repo',
    }
    const left: WorkspacePickerItem[] = [
      {
        id: target.id,
        name: 'repo',
        gitCapability: 'available',
        remoteDetails: [],
        lastSyncedAt: null,
        lifecycle: {
          kind: 'failed',
          reason: 'timeout',
          target,
        },
      },
    ]
    const right: WorkspacePickerItem[] = [
      {
        id: target.id,
        name: 'repo',
        gitCapability: 'available',
        remoteDetails: [],
        lastSyncedAt: null,
        lifecycle: {
          kind: 'failed',
          reason: 'timeout',
          target: {
            ...target,
            user: 'new-user',
            port: 2222,
            displayName: 'example-renamed:repo',
          },
        },
      },
    ]

    expect(workspacePickerItemsEqual(left, right)).toBe(false)
  })

  test('treats last sync time changes as unequal', () => {
    const left: WorkspacePickerItem[] = [
      {
        id: 'goblin+file:///tmp/repo',
        name: 'repo',
        gitCapability: 'available',
        remoteDetails: [],
        lastSyncedAt: 1_000,
        lifecycle: null,
      },
    ]
    const right: WorkspacePickerItem[] = [
      {
        id: 'goblin+file:///tmp/repo',
        name: 'repo',
        gitCapability: 'available',
        remoteDetails: [],
        lastSyncedAt: 2_000,
        lifecycle: null,
      },
    ]

    expect(workspacePickerItemsEqual(left, right)).toBe(false)
  })

  test('treats terminal bell count changes as unequal', () => {
    const left: WorkspacePickerItem[] = [
      {
        id: 'goblin+file:///tmp/repo',
        name: 'repo',
        gitCapability: 'available',
        remoteDetails: [],
        lastSyncedAt: null,
        terminalBellCount: 1,
        lifecycle: null,
      },
    ]
    const right: WorkspacePickerItem[] = [
      {
        id: 'goblin+file:///tmp/repo',
        name: 'repo',
        gitCapability: 'available',
        remoteDetails: [],
        lastSyncedAt: null,
        terminalBellCount: 2,
        lifecycle: null,
      },
    ]

    expect(workspacePickerItemsEqual(left, right)).toBe(false)
  })

  test('does not treat warm cache read-model time as a sync time', () => {
    const repo = emptyRepo('goblin+file:///tmp/repo', 'repo', 'repo-runtime-test')
    repo.projection = { source: 'cache', savedAt: 2_000 }
    repo.dataLoads.repoReadModel.loadedAt = 2_000

    expect(latestRepoSyncTime(repo)).toBeNull()
  })

  test('uses fresh read-model and fetch data-load times as sync candidates', () => {
    const repo = emptyRepo('goblin+file:///tmp/repo', 'repo', 'repo-runtime-test')
    repo.projection = { source: 'fresh', savedAt: null }
    repo.dataLoads.repoReadModel.loadedAt = 2_000
    repo.dataLoads.fetch.loadedAt = 3_000

    expect(latestRepoSyncTime(repo)).toBe(3_000)
  })
})
