import { describe, expect, test } from 'vitest'
import { latestRepoSyncTime } from '#/web/components/RepoTabs.tsx'
import { repoTabSummariesEqual } from '#/web/components/repo-tabs/summary-equality.ts'
import type { RepoTabSummary } from '#/web/components/repo-tabs/types.ts'
import { emptyRepo } from '#/web/stores/repos/helpers.ts'

describe('repoTabSummariesEqual', () => {
  test('treats remote lifecycle target changes as unequal even when repo id stays the same', () => {
    const left: RepoTabSummary[] = [
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
    const right: RepoTabSummary[] = [
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

    expect(repoTabSummariesEqual(left, right)).toBe(false)
  })

  test('treats last sync time changes as unequal', () => {
    const left: RepoTabSummary[] = [
      {
        id: '/tmp/repo',
        name: 'repo',
        remoteDetails: [],
        lastSyncedAt: 1_000,
        lifecycle: null,
      },
    ]
    const right: RepoTabSummary[] = [
      {
        id: '/tmp/repo',
        name: 'repo',
        remoteDetails: [],
        lastSyncedAt: 2_000,
        lifecycle: null,
      },
    ]

    expect(repoTabSummariesEqual(left, right)).toBe(false)
  })

  test('does not treat warm cache snapshot time as a sync time', () => {
    const repo = emptyRepo('/tmp/repo', 'repo')
    repo.projection = { source: 'cache', savedAt: 2_000 }
    repo.resources.snapshot.loadedAt = 2_000

    expect(latestRepoSyncTime(repo)).toBeNull()
  })

  test('uses fresh snapshot and fetch resource times as sync candidates', () => {
    const repo = emptyRepo('/tmp/repo', 'repo')
    repo.projection = { source: 'fresh', savedAt: null }
    repo.resources.snapshot.loadedAt = 2_000
    repo.resources.fetch.loadedAt = 3_000

    expect(latestRepoSyncTime(repo)).toBe(3_000)
  })
})
