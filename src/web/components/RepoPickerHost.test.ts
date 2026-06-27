import { describe, expect, test } from 'vitest'
import { latestRepoSyncTime } from '#/web/stores/repos/sync-time.ts'
import { repoPickerReposEqual } from '#/web/components/repo-picker/summary-equality.ts'
import type { RepoPickerRepo } from '#/web/components/repo-picker/types.ts'
import { emptyRepo } from '#/web/stores/repos/repo-state-factory.ts'

describe('repoPickerReposEqual', () => {
  test('treats remote lifecycle target changes as unequal even when repo id stays the same', () => {
    const left: RepoPickerRepo[] = [
      {
        id: 'ssh-config://example/srv%2Frepo',
        name: 'repo',
        remoteDetails: [],
        lastSyncedAt: null,
        lifecycle: {
          kind: 'ready',
          target: {
            id: 'ssh-config://example/srv%2Frepo',
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
    const right: RepoPickerRepo[] = [
      {
        id: 'ssh-config://example/srv%2Frepo',
        name: 'repo',
        remoteDetails: [],
        lastSyncedAt: null,
        lifecycle: {
          kind: 'ready',
          target: {
            id: 'ssh-config://example/srv%2Frepo',
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

    expect(repoPickerReposEqual(left, right)).toBe(false)
  })

  test('treats failed lifecycle target locator changes as unequal', () => {
    const target = {
      id: 'ssh-config://example/srv%2Frepo',
      alias: 'example',
      host: 'same-host.internal',
      user: 'old-user',
      port: 22,
      remotePath: '/srv/repo',
      displayName: 'example:repo',
    }
    const left: RepoPickerRepo[] = [
      {
        id: target.id,
        name: 'repo',
        remoteDetails: [],
        lastSyncedAt: null,
        lifecycle: {
          kind: 'failed',
          reason: 'timeout',
          target,
        },
      },
    ]
    const right: RepoPickerRepo[] = [
      {
        id: target.id,
        name: 'repo',
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

    expect(repoPickerReposEqual(left, right)).toBe(false)
  })

  test('treats last sync time changes as unequal', () => {
    const left: RepoPickerRepo[] = [
      {
        id: '/tmp/repo',
        name: 'repo',
        remoteDetails: [],
        lastSyncedAt: 1_000,
        lifecycle: null,
      },
    ]
    const right: RepoPickerRepo[] = [
      {
        id: '/tmp/repo',
        name: 'repo',
        remoteDetails: [],
        lastSyncedAt: 2_000,
        lifecycle: null,
      },
    ]

    expect(repoPickerReposEqual(left, right)).toBe(false)
  })

  test('does not treat warm cache snapshot time as a sync time', () => {
    const repo = emptyRepo('/tmp/repo', 'repo')
    repo.projection = { source: 'cache', savedAt: 2_000 }
    repo.dataLoads.snapshot.loadedAt = 2_000

    expect(latestRepoSyncTime(repo)).toBeNull()
  })

  test('uses fresh snapshot and fetch data-load times as sync candidates', () => {
    const repo = emptyRepo('/tmp/repo', 'repo')
    repo.projection = { source: 'fresh', savedAt: null }
    repo.dataLoads.snapshot.loadedAt = 2_000
    repo.dataLoads.fetch.loadedAt = 3_000

    expect(latestRepoSyncTime(repo)).toBe(3_000)
  })
})
