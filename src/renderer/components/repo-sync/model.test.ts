import { describe, expect, test } from 'bun:test'
import { getRepoSyncActivity, isRepoSyncBlocked } from '#/renderer/components/repo-sync/model.ts'
import { emptyRepo } from '#/renderer/stores/repos/helpers.ts'
import type { RepoState } from '#/renderer/stores/repos/types.ts'

function repo(overrides: Partial<RepoState> = {}): RepoState {
  return {
    ...emptyRepo('/tmp/goblin-sync-test', 'repo'),
    loading: false,
    statusLoading: false,
    ...overrides,
  }
}

describe('getRepoSyncActivity', () => {
  test('uses the highest-value active refresh stage', () => {
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
