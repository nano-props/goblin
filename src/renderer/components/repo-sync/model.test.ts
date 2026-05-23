import { describe, expect, test } from 'vitest'
import { getRepoSyncActivity, isRepoSyncBlocked } from '#/renderer/components/repo-sync/model.ts'
import { emptyRepo } from '#/renderer/stores/repos/helpers.ts'
import type { RepoDataSource, RepoState } from '#/renderer/stores/repos/types.ts'

interface RepoOverrides {
  dataSource?: RepoDataSource
  loading?: boolean
  statusLoading?: boolean
  pullRequestsLoading?: boolean
  currentBranch?: string
  logsByBranch?: RepoState['data']['logsByBranch']
  fetching?: boolean
  syncing?: boolean
  refreshing?: boolean
  selectedBranch?: string | null
}

function repo(overrides: RepoOverrides = {}): RepoState {
  const base = emptyRepo('/tmp/goblin-sync-test', 'repo')
  return {
    ...base,
    data: {
      ...base.data,
      currentBranch: overrides.currentBranch ?? base.data.currentBranch,
      logsByBranch: overrides.logsByBranch ?? base.data.logsByBranch,
    },
    ui: {
      ...base.ui,
      selectedBranch: overrides.selectedBranch ?? base.ui.selectedBranch,
    },
    async: {
      ...base.async,
      loading: overrides.loading ?? false,
      statusLoading: overrides.statusLoading ?? false,
      pullRequestsLoading: overrides.pullRequestsLoading ?? base.async.pullRequestsLoading,
      fetching: overrides.fetching ?? base.async.fetching,
      syncing: overrides.syncing ?? base.async.syncing,
      refreshing: overrides.refreshing ?? base.async.refreshing,
    },
    cache: {
      ...base.cache,
      source: overrides.dataSource ?? base.cache.source,
    },
  }
}

describe('getRepoSyncActivity', () => {
  test('uses the highest-value active refresh stage', () => {
    expect(getRepoSyncActivity(repo({ dataSource: 'cache', refreshing: true, statusLoading: true }))?.stage).toBe(
      'cache',
    )
    expect(getRepoSyncActivity(repo({ loading: true, syncing: true }))?.stage).toBe('branches')
    expect(getRepoSyncActivity(repo({ statusLoading: true, syncing: true }))?.stage).toBe('status')
    expect(getRepoSyncActivity(repo({ pullRequestsLoading: true, syncing: true }))?.stage).toBe('prs')
  })

  test('detects current branch log loading before remote activity', () => {
    expect(
      getRepoSyncActivity(
        repo({
          currentBranch: 'main',
          logsByBranch: { main: { entries: [], selectedHash: null, loading: true } },
          fetching: true,
        }),
      )?.stage,
    ).toBe('log')
  })

  test('falls back to remote activity and idle states', () => {
    expect(getRepoSyncActivity(repo({ fetching: true }))?.stage).toBe('remote')
    expect(getRepoSyncActivity(repo({ syncing: true }))?.stage).toBe('remote')
    expect(getRepoSyncActivity(repo())).toBeNull()
  })
})

describe('isRepoSyncBlocked', () => {
  test('blocks while network or required initial refresh state is active', () => {
    expect(isRepoSyncBlocked(repo({ syncing: true }))).toBe(true)
    expect(isRepoSyncBlocked(repo({ fetching: true }))).toBe(true)
    expect(isRepoSyncBlocked(repo({ loading: true }))).toBe(true)
    expect(isRepoSyncBlocked(repo({ statusLoading: true }))).toBe(true)
    expect(isRepoSyncBlocked(repo({ dataSource: 'cache', refreshing: true }))).toBe(true)
  })

  test('does not block manual sync for secondary metadata refreshes', () => {
    expect(isRepoSyncBlocked(repo({ pullRequestsLoading: true }))).toBe(false)
    expect(
      isRepoSyncBlocked(
        repo({
          selectedBranch: 'feature',
          logsByBranch: { feature: { entries: [], selectedHash: null, loading: true } },
        }),
      ),
    ).toBe(false)
  })
})
