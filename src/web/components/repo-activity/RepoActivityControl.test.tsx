import { describe, expect, test } from 'vitest'
import { getRepoActivityControlView, isRepoPrimaryRefreshBusy } from '#/web/components/repo-activity/model.ts'
import { seedRepoShellForTest, resetWorkspacesStore } from '#/web/test-utils/bridge.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { markRepoOperationTargets, nextRepoOperationId } from '#/web/stores/workspaces/repo-operation-scheduler.ts'
import type { RepoOperationsSnapshot } from '#/shared/api-types.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

const REPO_ID = workspaceIdForTest('goblin+file:///workspace/repo-activity-control')

describe('RepoActivityControl', () => {
  test('marks the primary refresh button busy from server operation projection', () => {
    resetWorkspacesStore()
    const repo = seedRepoShellForTest({ id: REPO_ID })
    const operations: RepoOperationsSnapshot = {
      operations: [
        {
          id: 'repo-op-1',
          repoId: REPO_ID,
          workspaceRuntimeId: repo.workspaceRuntimeId,
          kind: 'fetch',
          phase: 'running',
          source: 'user',
          target: null,
          queuedAt: 100,
          startedAt: 101,
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
        },
      ],
      loadedAt: 123,
    }

    expect(isRepoPrimaryRefreshBusy(repo, operations)).toBe(true)
    expect(
      getRepoActivityControlView({
        visibleActivity: null,
        completion: null,
        manualSyncBusy: isRepoPrimaryRefreshBusy(repo, operations),
      }),
    ).toMatchObject({ kind: 'refresh-button', manualSyncBusy: true })
  })

  test('marks the primary refresh button busy during any fetch', () => {
    resetWorkspacesStore()
    seedRepoShellForTest({ id: REPO_ID })
    markRepoOperationTargets(REPO_ID, nextRepoOperationId(REPO_ID), [{ key: 'fetch', reason: 'fetch' }], 'running')

    const repo = useWorkspacesStore.getState().workspaces[REPO_ID]!
    expect(isRepoPrimaryRefreshBusy(repo)).toBe(true)
    expect(
      getRepoActivityControlView({
        visibleActivity: null,
        completion: null,
        manualSyncBusy: isRepoPrimaryRefreshBusy(repo),
      }),
    ).toMatchObject({ kind: 'refresh-button', manualSyncBusy: true })
  })

  test('marks the primary refresh button busy during manual refreshes', () => {
    resetWorkspacesStore()
    seedRepoShellForTest({ id: REPO_ID })
    markRepoOperationTargets(
      REPO_ID,
      nextRepoOperationId(REPO_ID),
      [{ key: 'manualRefresh', reason: 'manual-refresh' }],
      'running',
    )

    const repo = useWorkspacesStore.getState().workspaces[REPO_ID]!
    expect(isRepoPrimaryRefreshBusy(repo)).toBe(true)
    expect(
      getRepoActivityControlView({
        visibleActivity: null,
        completion: null,
        manualSyncBusy: isRepoPrimaryRefreshBusy(repo),
      }),
    ).toMatchObject({ kind: 'refresh-button', manualSyncBusy: true })
  })

  test('shows the primary refresh button for local-only repositories', () => {
    resetWorkspacesStore()
    seedRepoShellForTest({ id: REPO_ID, remote: { hasRemotes: false } })

    const repo = useWorkspacesStore.getState().workspaces[REPO_ID]!
    expect(
      getRepoActivityControlView({
        visibleActivity: null,
        completion: null,
        manualSyncBusy: isRepoPrimaryRefreshBusy(repo),
      }),
    ).toMatchObject({ kind: 'refresh-button', manualSyncBusy: false })
  })
})
