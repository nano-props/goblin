import { describe, expect, test } from 'vitest'
import {
  getRepoActivity,
  isRepoPrimaryRefreshBusy,
  type RepoActivityProjectionRepo,
  repoOperationsSnapshotHasPrimaryRefresh,
} from '#/web/components/repo-activity/model.ts'
import { seedRepoShellForTest } from '#/web/test-utils/bridge.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { resetWorkspacesStore } from '#/web/test-utils/bridge.ts'
import {
  markRepoOperationTargets,
  nextRepoOperationId,
  settleRepoOperationTargets,
} from '#/web/stores/workspaces/repo-operation-scheduler.ts'
import type { WorkspaceState } from '#/web/stores/workspaces/types.ts'
import type { RepoOperationsSnapshot, RepoServerOperationState } from '#/shared/api-types.ts'

const REPO_ID = 'goblin+file:///tmp/goblin-repo-activity-model'

describe('repo activity model', () => {
  test('marks the primary refresh control busy from user server fetch operations', () => {
    resetWorkspacesStore()
    const repo = seedRepoShellForTest({ id: REPO_ID })
    const operations = operationsSnapshot([serverOperation({ kind: 'fetch', phase: 'running', source: 'user' })])

    expect(repoOperationsSnapshotHasPrimaryRefresh(operations)).toBe(true)
    expect(isRepoPrimaryRefreshBusy(repo, operations)).toBe(true)
  })

  test('keeps the primary refresh control idle during background server fetch operations', () => {
    resetWorkspacesStore()
    const repo = seedRepoShellForTest({ id: REPO_ID })
    const operations = operationsSnapshot([serverOperation({ kind: 'fetch', phase: 'running', source: 'background' })])

    expect(repoOperationsSnapshotHasPrimaryRefresh(operations)).toBe(false)
    expect(isRepoPrimaryRefreshBusy(repo, operations)).toBe(false)
  })

  test('does not treat non-fetch server operations as primary refresh busy', () => {
    resetWorkspacesStore()
    const repo = seedRepoShellForTest({ id: REPO_ID })
    const operations = operationsSnapshot([serverOperation({ kind: 'pull', phase: 'running', source: 'user' })])

    expect(repoOperationsSnapshotHasPrimaryRefresh(operations)).toBe(false)
    expect(isRepoPrimaryRefreshBusy(repo, operations)).toBe(false)
  })

  test('projects branch action activity from server operations', () => {
    resetWorkspacesStore()
    const repo = seedRepoShellForTest({ id: REPO_ID })
    const operations = operationsSnapshot([serverOperation({ kind: 'push', phase: 'queued', source: 'user' })])

    expect(getRepoActivity(activityRepo(repo), operations)).toMatchObject({
      kind: 'branch-action',
      labelKey: 'action.push-queued',
    })
  })

  test('marks the primary refresh control busy while a manual refresh is active', () => {
    resetWorkspacesStore()
    seedRepoShellForTest({ id: REPO_ID })
    const opId = nextRepoOperationId(REPO_ID)
    markRepoOperationTargets(REPO_ID, opId, [{ key: 'manualRefresh', reason: 'manual-refresh' }], 'running')

    expect(isRepoPrimaryRefreshBusy(useWorkspacesStore.getState().workspaces[REPO_ID]!)).toBe(true)

    settleRepoOperationTargets(REPO_ID, opId, [{ key: 'manualRefresh', reason: 'manual-refresh' }], null)

    expect(isRepoPrimaryRefreshBusy(useWorkspacesStore.getState().workspaces[REPO_ID]!)).toBe(false)
  })
})

function operationsSnapshot(operations: RepoServerOperationState[]): RepoOperationsSnapshot {
  return { operations, loadedAt: 123 }
}

function activityRepo(repo: WorkspaceState): RepoActivityProjectionRepo {
  return {
    id: repo.id,
    branchAction: repo.operations.branchAction,
  }
}

function serverOperation(
  overrides: Pick<RepoServerOperationState, 'kind' | 'phase' | 'source'>,
): RepoServerOperationState {
  return {
    id: `repo-op-${overrides.kind}-${overrides.phase}`,
    repoId: REPO_ID,
    workspaceRuntimeId: null,
    kind: overrides.kind,
    phase: overrides.phase,
    source: overrides.source,
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
