import { describe, expect, test } from 'vitest'
import {
  getRepoActivity,
  isRepoPrimaryRefreshBusy,
  type RepoActivityProjectionRepo,
  repoOperationsSnapshotHasPrimaryRefresh,
} from '#/web/components/repo-activity/model.ts'
import { seedRepoShellForTest } from '#/web/test-utils/bridge.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { resetReposStore } from '#/web/test-utils/bridge.ts'
import {
  markRepoOperationTargets,
  nextRepoOperationId,
  settleRepoOperationTargets,
} from '#/web/stores/repos/repo-operation-scheduler.ts'
import type { RepoState } from '#/web/stores/repos/types.ts'
import type { RepoOperationsSnapshot, RepoServerOperationState } from '#/shared/api-types.ts'

const REPO_ID = '/tmp/gbl-repo-activity-model'

describe('repo activity model', () => {
  test('marks the primary refresh control busy from server fetch operations', () => {
    resetReposStore()
    const repo = seedRepoShellForTest({ id: REPO_ID })
    const operations = operationsSnapshot([serverOperation({ kind: 'fetch', phase: 'running' })])

    expect(repoOperationsSnapshotHasPrimaryRefresh(operations)).toBe(true)
    expect(isRepoPrimaryRefreshBusy(repo, operations)).toBe(true)
  })

  test('does not treat non-fetch server operations as primary refresh busy', () => {
    resetReposStore()
    const repo = seedRepoShellForTest({ id: REPO_ID })
    const operations = operationsSnapshot([serverOperation({ kind: 'pull', phase: 'running' })])

    expect(repoOperationsSnapshotHasPrimaryRefresh(operations)).toBe(false)
    expect(isRepoPrimaryRefreshBusy(repo, operations)).toBe(false)
  })

  test('projects branch action activity from server operations', () => {
    resetReposStore()
    const repo = seedRepoShellForTest({ id: REPO_ID })
    const operations = operationsSnapshot([serverOperation({ kind: 'push', phase: 'queued' })])

    expect(getRepoActivity(activityRepo(repo), operations)).toMatchObject({
      kind: 'branch-action',
      labelKey: 'action.push-queued',
    })
  })

  test('marks the primary refresh control busy while a manual refresh is active', () => {
    resetReposStore()
    seedRepoShellForTest({ id: REPO_ID })
    const opId = nextRepoOperationId(REPO_ID)
    markRepoOperationTargets(REPO_ID, opId, [{ key: 'manualRefresh', reason: 'manual-refresh' }], 'running')

    expect(isRepoPrimaryRefreshBusy(useReposStore.getState().repos[REPO_ID]!)).toBe(true)

    settleRepoOperationTargets(REPO_ID, opId, [{ key: 'manualRefresh', reason: 'manual-refresh' }], null)

    expect(isRepoPrimaryRefreshBusy(useReposStore.getState().repos[REPO_ID]!)).toBe(false)
  })
})

function operationsSnapshot(operations: RepoServerOperationState[]): RepoOperationsSnapshot {
  return { operations, loadedAt: 123 }
}

function activityRepo(repo: RepoState): RepoActivityProjectionRepo {
  return {
    id: repo.id,
    branchAction: repo.operations.branchAction,
  }
}

function serverOperation(
  overrides: Pick<RepoServerOperationState, 'kind' | 'phase'>,
): RepoServerOperationState {
  return {
    id: `repo-op-${overrides.kind}-${overrides.phase}`,
    repoId: REPO_ID,
    repoRuntimeId: null,
    kind: overrides.kind,
    phase: overrides.phase,
    source: 'user',
    target: null,
    queuedAt: 100,
    startedAt: overrides.phase === 'queued' ? null : 101,
    deadlineAt: null,
    settledAt: null,
    error: null,
    cancellation: {
      underlyingRequested: false,
      reason: null,
      requestedAt: null,
      waitCancelledCount: 0,
      lastWaitCancelledAt: null,
      lastWaitCancellationReason: null,
    },
    canCancelUnderlying: true,
  }
}
