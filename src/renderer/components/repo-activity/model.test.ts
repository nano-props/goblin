import { afterEach, describe, expect, test } from 'vitest'
import {
  getRepoActivity,
  getRepoActivityControlPresentation,
  getRepoActivityControlView,
  isRepoSyncBlocked,
  type RepoActivity,
  type RepoCompletion,
} from '#/renderer/components/repo-activity/model.ts'
import { emptyRepo } from '#/renderer/stores/repos/helpers.ts'
import { startPullRequestResource, startResource } from '#/renderer/stores/repos/resources.ts'
import { markRepoOperationViews, type RepoBranchActionReason } from '#/renderer/stores/repos/operations.ts'
import { disposeRepoRuntime, markRepoOperationTargets, nextRepoOperationId } from '#/renderer/stores/repos/runtime.ts'
import type { RepoBranchActionKind } from '#/renderer/stores/repos/branch-action-types.ts'
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
  branchActionKind?: RepoBranchActionKind
  branchActionTarget?: string
  branchActionPhase?: 'queued' | 'running'
  selectedBranch?: string | null
  unavailable?: boolean
}

function repo(overrides: RepoOverrides = {}): RepoState {
  const base = emptyRepo('/tmp/goblin-sync-test', 'repo')
  if (overrides.snapshotBusy) startResource(base.resources.snapshot)
  if (overrides.statusBusy) startResource(base.resources.status)
  if (overrides.pullRequestsBusy) startPullRequestResource(base.resources.pullRequests, 'full')
  if (overrides.fetchBusy) startResource(base.resources.fetch)
  if (overrides.branchActionBusy) {
    const kind = overrides.branchActionKind ?? 'checkout'
    markRepoOperationViews(
      base.operations,
      1,
      [
        {
          key: 'branchAction',
          reason: branchActionReason(kind),
          target: overrides.branchActionTarget ?? 'feature/a',
        },
      ],
      overrides.branchActionPhase ?? 'running',
    )
  }
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
    availability: overrides.unavailable
      ? { phase: 'unavailable', reason: 'error.failed-read-repo', checkedAt: 1 }
      : base.availability,
  }
}

function branchActionReason(kind: RepoBranchActionKind): RepoBranchActionReason {
  return `branch:${kind}` as RepoBranchActionReason
}

afterEach(() => {
  disposeRepoRuntime('/tmp/goblin-sync-test')
})

describe('getRepoActivity', () => {
  test('uses the highest-value active refresh stage', () => {
    expect(getRepoActivity(repo({ dataSource: 'cache', snapshotBusy: true, statusBusy: true }))?.kind).toBe(
      'cache-refresh',
    )
    expect(getRepoActivity(repo({ snapshotBusy: true, fetchBusy: true }))?.kind).toBe('snapshot-refresh')
    expect(getRepoActivity(repo({ branchActionBusy: true }))?.kind).toBe('branch-action')
    expect(getRepoActivity(repo({ dataSource: 'cache', statusBusy: true }))?.kind).toBe('status-refresh')
    expect(getRepoActivity(repo({ statusBusy: true, fetchBusy: true }))?.kind).toBe('status-refresh')
    expect(getRepoActivity(repo({ pullRequestsBusy: true, fetchBusy: true }))?.kind).toBe('pull-request-refresh')
  })

  test('detects current branch log loading before remote activity', () => {
    expect(
      getRepoActivity(
        repo({
          currentBranch: 'main',
          logBusyBranch: 'main',
          fetchBusy: true,
        }),
      )?.kind,
    ).toBe('log-refresh')
  })

  test('detects any repo log loading, even when it is not the visible branch', () => {
    expect(
      getRepoActivity(repo({ currentBranch: 'main', selectedBranch: 'main', logBusyBranch: 'feature/a' }))?.kind,
    ).toBe('log-refresh')
  })

  test('treats any concurrent branch log operation as repo activity', () => {
    expect(getRepoActivity(repo({ logBusyBranches: ['feature/a', 'feature/b'] }))?.kind).toBe('log-refresh')
  })

  test('keeps branch-changing work above metadata and remote stages', () => {
    expect(
      getRepoActivity(
        repo({
          dataSource: 'cache',
          branchActionBusy: true,
          snapshotBusy: true,
          statusBusy: true,
          pullRequestsBusy: true,
          logBusyBranch: 'feature/a',
          fetchBusy: true,
        }),
      )?.kind,
    ).toBe('branch-action')
  })

  test('uses action-specific labels for branch actions', () => {
    expect(getRepoActivity(repo({ branchActionBusy: true, branchActionKind: 'createWorktree' }))).toMatchObject({
      kind: 'branch-action',
      labelKey: 'action.create-worktree-creating-title',
      blocksSync: true,
    })
    expect(getRepoActivity(repo({ branchActionBusy: true, branchActionKind: 'removeWorktree' }))).toMatchObject({
      kind: 'branch-action',
      labelKey: 'action.remove-worktree-removing-title',
      blocksSync: true,
    })
    expect(getRepoActivity(repo({ branchActionBusy: true, branchActionKind: 'deleteBranch' }))).toMatchObject({
      kind: 'branch-action',
      labelKey: 'action.delete-branch-deleting-title',
      blocksSync: true,
    })
  })

  test('uses short waiting labels for queued branch network actions', () => {
    const r = repo({
      branchActionBusy: true,
      branchActionKind: 'pull',
      branchActionTarget: 'feature/a',
      branchActionPhase: 'queued',
    })

    expect(getRepoActivity(r)).toMatchObject({
      kind: 'branch-action',
      labelKey: 'action.pull-queued',
      blocksSync: true,
    })
  })

  test('keeps branch network actions waiting while core refresh is busy', () => {
    const r = repo({
      branchActionBusy: true,
      branchActionKind: 'push',
      branchActionTarget: 'feature/a',
      branchActionPhase: 'queued',
      statusBusy: true,
    })

    expect(getRepoActivity(r)).toMatchObject({
      kind: 'branch-action',
      labelKey: 'action.push-queued',
      blocksSync: true,
    })
  })

  test('uses running labels when the operation phase is running', () => {
    const running = repo({
      branchActionBusy: true,
      branchActionKind: 'pull',
      branchActionTarget: 'feature/a',
      branchActionPhase: 'running',
    })
    const unset = repo({ branchActionBusy: true, branchActionKind: 'push', branchActionTarget: 'feature/a' })

    expect(getRepoActivity(running)).toMatchObject({
      kind: 'branch-action',
      labelKey: 'action.pull-loading',
    })
    expect(getRepoActivity(unset)).toMatchObject({
      kind: 'branch-action',
      labelKey: 'action.push-loading',
    })
  })

  test('falls back to remote activity and idle states', () => {
    expect(getRepoActivity(repo({ fetchBusy: true }))?.kind).toBe('remote-fetch')
    expect(getRepoActivity(repo())).toBeNull()
  })

  test('does not surface runtime-only work as visible activity', () => {
    const r = repo()
    markRepoOperationTargets(r.id, nextRepoOperationId(r.id), [{ key: 'fetch', reason: 'fetch' }], 'running')

    expect(getRepoActivity(r)).toBeNull()
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

describe('getRepoActivityControlPresentation', () => {
  test('shows visible metadata loading as an activity indicator', () => {
    const r = repo({ pullRequestsBusy: true })
    const activity = getRepoActivity(r)

    expect(getRepoActivityControlPresentation(r, activity)).toEqual({
      syncBlocked: false,
      visibleActivity: activity,
      showingActivity: true,
    })
  })

  test('shows fetch-unsafe loading as a blocking activity indicator', () => {
    const r = repo({ statusBusy: true })
    const activity = getRepoActivity(r)

    expect(getRepoActivityControlPresentation(r, activity)).toEqual({
      syncBlocked: true,
      visibleActivity: activity,
      showingActivity: true,
    })
  })

  test('keeps the button visually idle while the delay hook hides raw activity', () => {
    const r = repo({ fetchBusy: true })

    expect(getRepoActivityControlPresentation(r, null)).toEqual({
      syncBlocked: true,
      visibleActivity: null,
      showingActivity: false,
    })
  })

  test('keeps hidden non-blocking activity visually idle and enabled', () => {
    const r = repo({ pullRequestsBusy: true })

    expect(getRepoActivityControlPresentation(r, null)).toEqual({
      syncBlocked: false,
      visibleActivity: null,
      showingActivity: false,
    })
  })

  test('keeps runtime-only blocking work visually idle until resources show activity', () => {
    const r = repo()
    markRepoOperationTargets(r.id, nextRepoOperationId(r.id), [{ key: 'fetch', reason: 'fetch' }], 'running')

    expect(getRepoActivityControlPresentation(r, null)).toEqual({
      syncBlocked: true,
      visibleActivity: null,
      showingActivity: false,
    })
  })

  test('blocks sync when the repo is unavailable', () => {
    const r = repo({ unavailable: true })

    expect(getRepoActivityControlPresentation(r, null)).toEqual({
      syncBlocked: true,
      visibleActivity: null,
      showingActivity: false,
    })
  })
})

describe('getRepoActivityControlView', () => {
  const branchActivity: RepoActivity = {
    kind: 'branch-action',
    labelKey: 'action.create-worktree-creating-title',
    blocksSync: true,
  }
  const statusActivity: RepoActivity = {
    kind: 'status-refresh',
    labelKey: 'tab.refreshing-status',
    blocksSync: true,
  }
  const completion: RepoCompletion = {
    id: 1,
    labelKey: 'action.create-worktree-created-title',
  }

  test('keeps branch actions above completion feedback', () => {
    expect(
      getRepoActivityControlView({
        visibleActivity: branchActivity,
        completion,
        syncBlocked: true,
        localOnly: false,
      }),
    ).toEqual({ kind: 'activity', activity: branchActivity })
  })

  test('shows completion above non-branch repo activity', () => {
    expect(
      getRepoActivityControlView({
        visibleActivity: statusActivity,
        completion,
        syncBlocked: true,
        localOnly: false,
      }),
    ).toEqual({ kind: 'completion', completion })
  })

  test('shows non-branch repo activity when no completion is visible', () => {
    expect(
      getRepoActivityControlView({
        visibleActivity: statusActivity,
        completion: null,
        syncBlocked: true,
        localOnly: true,
      }),
    ).toEqual({ kind: 'activity', activity: statusActivity })
  })

  test('shows completion when there is no activity', () => {
    expect(
      getRepoActivityControlView({
        visibleActivity: null,
        completion,
        syncBlocked: false,
        localOnly: true,
      }),
    ).toEqual({ kind: 'completion', completion })
  })

  test('falls back to refresh button and carries sync blocking state', () => {
    expect(
      getRepoActivityControlView({
        visibleActivity: null,
        completion: null,
        syncBlocked: true,
        localOnly: false,
      }),
    ).toEqual({ kind: 'refresh-button', syncBlocked: true })
    expect(
      getRepoActivityControlView({
        visibleActivity: null,
        completion: null,
        syncBlocked: false,
        localOnly: false,
      }),
    ).toEqual({ kind: 'refresh-button', syncBlocked: false })
  })

  test('shows local-only idle state without a refresh button', () => {
    expect(
      getRepoActivityControlView({
        visibleActivity: null,
        completion: null,
        syncBlocked: false,
        localOnly: true,
      }),
    ).toEqual({ kind: 'local-only' })
  })
})
