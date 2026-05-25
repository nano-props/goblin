import { afterEach, describe, expect, test } from 'vitest'
import {
  getRepoSyncActivity,
  getRepoSyncPresentation,
  isRepoSyncBlocked,
} from '#/renderer/components/repo-sync/model.ts'
import { emptyRepo } from '#/renderer/stores/repos/helpers.ts'
import {
  startBranchActionResource,
  startPullRequestResource,
  startResource,
} from '#/renderer/stores/repos/resources.ts'
import { disposeRepoRuntime, markRepoOperationTargets, nextRepoOperationId } from '#/renderer/stores/repos/runtime.ts'
import type { RepoDataSource, RepoState } from '#/renderer/stores/repos/types.ts'

interface RepoOverrides {
  dataSource?: RepoDataSource
  snapshotBusy?: boolean
  branchActionBusy?: boolean
  statusBusy?: boolean
  pullRequestsBusy?: boolean
  currentBranch?: string
  logsByBranch?: RepoState['data']['logsByBranch']
  logBusyBranch?: string
  logBusyBranches?: string[]
  fetchBusy?: boolean
  selectedBranch?: string | null
}

function repo(overrides: RepoOverrides = {}): RepoState {
  const base = emptyRepo('/tmp/goblin-sync-test', 'repo')
  if (overrides.snapshotBusy) startResource(base.resources.snapshot)
  if (overrides.statusBusy) startResource(base.resources.status)
  if (overrides.pullRequestsBusy) startPullRequestResource(base.resources.pullRequests, 'full')
  if (overrides.fetchBusy) startResource(base.resources.fetch)
  if (overrides.branchActionBusy) startBranchActionResource(base.resources.branchAction, 'checkout', 'feature/a')
  for (const branch of overrides.logBusyBranches ?? (overrides.logBusyBranch ? [overrides.logBusyBranch] : [])) {
    base.resources.logsByBranch[branch] = { phase: 'loading', loadedAt: null, error: null, stale: false }
  }
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
    cache: {
      ...base.cache,
      source: overrides.dataSource ?? base.cache.source,
    },
  }
}

afterEach(() => {
  disposeRepoRuntime('/tmp/goblin-sync-test')
})

describe('getRepoSyncActivity', () => {
  test('uses the highest-value active refresh stage', () => {
    expect(getRepoSyncActivity(repo({ dataSource: 'cache', snapshotBusy: true, statusBusy: true }))?.stage).toBe(
      'cache',
    )
    expect(getRepoSyncActivity(repo({ snapshotBusy: true, fetchBusy: true }))?.stage).toBe('branches')
    expect(getRepoSyncActivity(repo({ branchActionBusy: true }))?.stage).toBe('branches')
    expect(getRepoSyncActivity(repo({ dataSource: 'cache', statusBusy: true }))?.stage).toBe('status')
    expect(getRepoSyncActivity(repo({ statusBusy: true, fetchBusy: true }))?.stage).toBe('status')
    expect(getRepoSyncActivity(repo({ pullRequestsBusy: true, fetchBusy: true }))?.stage).toBe('prs')
  })

  test('detects current branch log loading before remote activity', () => {
    expect(
      getRepoSyncActivity(
        repo({
          currentBranch: 'main',
          logBusyBranch: 'main',
          fetchBusy: true,
        }),
      )?.stage,
    ).toBe('log')
  })

  test('detects any repo log loading, even when it is not the visible branch', () => {
    expect(
      getRepoSyncActivity(repo({ currentBranch: 'main', selectedBranch: 'main', logBusyBranch: 'feature/a' }))?.stage,
    ).toBe('log')
  })

  test('treats any concurrent branch log operation as repo activity', () => {
    expect(getRepoSyncActivity(repo({ logBusyBranches: ['feature/a', 'feature/b'] }))?.stage).toBe('log')
  })

  test('keeps branch-changing work above metadata and remote stages', () => {
    expect(
      getRepoSyncActivity(
        repo({
          branchActionBusy: true,
          statusBusy: true,
          pullRequestsBusy: true,
          logBusyBranch: 'feature/a',
          fetchBusy: true,
        }),
      )?.stage,
    ).toBe('branches')
  })

  test('falls back to remote activity and idle states', () => {
    expect(getRepoSyncActivity(repo({ fetchBusy: true }))?.stage).toBe('remote')
    expect(getRepoSyncActivity(repo())).toBeNull()
  })

  test('does not surface runtime-only work as visible activity', () => {
    const r = repo()
    markRepoOperationTargets(r.id, nextRepoOperationId(r.id), [{ key: 'fetch', reason: 'fetch' }], 'running')

    expect(getRepoSyncActivity(r)).toBeNull()
  })
})

describe('isRepoSyncBlocked', () => {
  test('blocks while network or required initial refresh state is active', () => {
    expect(isRepoSyncBlocked(repo({ fetchBusy: true }))).toBe(true)
    expect(isRepoSyncBlocked(repo({ branchActionBusy: true }))).toBe(true)
    expect(isRepoSyncBlocked(repo({ snapshotBusy: true }))).toBe(true)
    expect(isRepoSyncBlocked(repo({ statusBusy: true }))).toBe(true)
    expect(isRepoSyncBlocked(repo({ dataSource: 'cache', snapshotBusy: true }))).toBe(true)
  })

  test('does not block manual sync for metadata refreshes', () => {
    expect(isRepoSyncBlocked(repo({ pullRequestsBusy: true }))).toBe(false)
    expect(
      isRepoSyncBlocked(
        repo({
          selectedBranch: 'feature',
          logBusyBranch: 'feature',
        }),
      ),
    ).toBe(false)
  })
})

describe('getRepoSyncPresentation', () => {
  test('disables visible metadata loading to keep button presentation consistent', () => {
    const r = repo({ pullRequestsBusy: true })
    const activity = getRepoSyncActivity(r)

    expect(getRepoSyncPresentation(r, activity)).toEqual({
      rawBlocked: false,
      visibleActivity: activity,
      visualBusy: true,
      visualDisabled: true,
    })
  })

  test('shows fetch-unsafe loading as disabled once it becomes visible', () => {
    const r = repo({ statusBusy: true })
    const activity = getRepoSyncActivity(r)

    expect(getRepoSyncPresentation(r, activity)).toEqual({
      rawBlocked: true,
      visibleActivity: activity,
      visualBusy: true,
      visualDisabled: true,
    })
  })

  test('keeps the button visually idle while the delay hook hides raw activity', () => {
    const r = repo({ fetchBusy: true })

    expect(getRepoSyncPresentation(r, null)).toEqual({
      rawBlocked: true,
      visibleActivity: null,
      visualBusy: false,
      visualDisabled: false,
    })
  })

  test('keeps hidden non-blocking activity visually idle and enabled', () => {
    const r = repo({ pullRequestsBusy: true })

    expect(getRepoSyncPresentation(r, null)).toEqual({
      rawBlocked: false,
      visibleActivity: null,
      visualBusy: false,
      visualDisabled: false,
    })
  })

  test('keeps runtime-only blocking work visually idle until resources show activity', () => {
    const r = repo()
    markRepoOperationTargets(r.id, nextRepoOperationId(r.id), [{ key: 'fetch', reason: 'fetch' }], 'running')

    expect(getRepoSyncPresentation(r, null)).toEqual({
      rawBlocked: true,
      visibleActivity: null,
      visualBusy: false,
      visualDisabled: false,
    })
  })
})
