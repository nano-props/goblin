import { seedRepoWithReadModelForTest, resetWorkspacesStore } from '#/web/test-utils/repo-store.ts'
import { describe, expect, test } from 'vitest'
import {
  getRepoActivity,
  type RepoActivityProjectionRepo,
  repoOperationsSnapshotHasPrimaryRefresh,
} from '#/web/components/repo-activity/model.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import type { WorkspaceState } from '#/web/stores/workspaces/types.ts'
import type { RepoOperationsSnapshot, RepoServerOperationState } from '#/shared/api-types.ts'

const REPO_ID = workspaceIdForTest('goblin+file:///workspace/repo-activity-model')

describe('repo activity model', () => {
  test('marks the primary refresh control busy from user server fetch operations', () => {
    const operations = operationsSnapshot([serverOperation({ kind: 'fetch', phase: 'running', source: 'user' })])

    expect(repoOperationsSnapshotHasPrimaryRefresh(operations)).toBe(true)
  })

  test('keeps the primary refresh control idle during background server fetch operations', () => {
    const operations = operationsSnapshot([serverOperation({ kind: 'fetch', phase: 'running', source: 'background' })])

    expect(repoOperationsSnapshotHasPrimaryRefresh(operations)).toBe(false)
  })

  test('does not treat non-fetch server operations as primary refresh busy', () => {
    const operations = operationsSnapshot([serverOperation({ kind: 'pull', phase: 'running', source: 'user' })])

    expect(repoOperationsSnapshotHasPrimaryRefresh(operations)).toBe(false)
  })

  test('projects branch action activity from server operations', () => {
    resetWorkspacesStore()
    const repo = seedRepoWithReadModelForTest({ id: REPO_ID })
    const operations = operationsSnapshot([serverOperation({ kind: 'push', phase: 'queued', source: 'user' })])

    expect(getRepoActivity(activityRepo(repo), operations)).toMatchObject({
      kind: 'branch-action',
      labelKey: 'action.push-queued',
    })
  })
})

function operationsSnapshot(operations: RepoServerOperationState[]): RepoOperationsSnapshot {
  return { operations, lastFetchAt: null, loadedAt: 123 }
}

function activityRepo(repo: WorkspaceState): RepoActivityProjectionRepo {
  if (repo.capability.kind !== 'git') throw new Error('expected Git workspace fixture')
  return {
    branchAction: repo.capability.git.operations.branchAction,
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
