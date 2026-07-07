import { appendRepoEvent, errorEvent } from '#/web/stores/repos/repo-state-factory.ts'
import { updateIfFresh } from '#/web/stores/repos/repo-guards.ts'
import { refreshStatusLog } from '#/web/logger.ts'
import { isRepoUnavailableReason, markRepoUnavailable } from '#/web/stores/repos/availability.ts'
import { runExclusiveOperation, runLatestOperation } from '#/web/stores/repos/operation-runner.ts'
import { persistRepoSnapshotCacheEntry } from '#/web/stores/repos/persistence.ts'
import { runLatestDataLoadOperation } from '#/web/stores/repos/data-load-runner.ts'
import { runCoreDataRefreshWorkflow, runSnapshotSuccessWorkflow } from '#/web/stores/repos/refresh-workflows.ts'
import {
  applySnapshotToRepoProjection,
  resolveActionRepoInstanceId,
} from '#/web/stores/repos/refresh-state.ts'
import { createRefreshSyncHelpers } from '#/web/stores/repos/refresh-sync.ts'
import { runWithRepoInvalidationSource } from '#/web/stores/repos/invalidation-sources.ts'
import { finishDataLoadError, finishDataLoadSuccess, startDataLoad } from '#/web/stores/repos/repo-data-load-state.ts'
import { getRepoSnapshot, getRepoStatus, readRepoBulk } from '#/web/repo-client.ts'
import {
  setRepoBulkReadQueryData,
  getRepoSnapshotQueryData,
  getRepoStatusQueryData,
  setRepoSnapshotQueryData,
  setRepoStatusQueryData,
} from '#/web/repo-data-query.ts'
import { readRepoBranchQueryProjection } from '#/web/repo-branch-read-model.ts'
import type { RepoSnapshot } from '#/shared/api-types.ts'
import type { ReposGet, ReposSet } from '#/web/stores/repos/types.ts'

export function createRefreshActions(set: ReposSet, get: ReposGet) {
  const { runManualSyncPipeline } = createRefreshSyncHelpers(set, get)

  async function runSnapshotSuccessFlow(
    id: string,
    repoInstanceId: string,
    snap: RepoSnapshot,
    previousSnapshotBranches: RepoSnapshot['branches'] | null,
    isSnapshotCurrent: () => boolean,
  ): Promise<void> {
    const validBranches = new Set(snap.branches.map((b) => b.name))
    updateIfFresh(set, id, repoInstanceId, (r) => {
      applySnapshotToRepoProjection(r, snap, validBranches, previousSnapshotBranches)
    })
    await runSnapshotSuccessWorkflow(set, get, {
      id,
      repoInstanceId,
      isSnapshotCurrent,
    })
  }

  return {
    async refreshSnapshot(id: string, options?: { skipLogBackfill?: boolean; repoInstanceId?: string }) {
      const resolved = resolveActionRepoInstanceId(get, id, options?.repoInstanceId)
      if (!resolved) return
      const { repoInstanceId } = resolved
      updateIfFresh(set, id, repoInstanceId, (r) => {
        startDataLoad(r.dataLoads.snapshot, { hasData: (readRepoBranchQueryProjection(r)?.branches.length ?? 0) > 0 })
      })
      await runLatestOperation({
        set,
        get,
        id,
        repoInstanceId,
        lane: 'read',
        operationKey: 'snapshot',
        priority: 50,
        targets: [{ key: 'snapshot', reason: 'snapshot' }],
        task: (signal) => getRepoSnapshot(id, signal),
        errorFromResult: (snap) => (snap ? null : 'error.failed-read-repo'),
        onResult: async (snap, ctx) => {
          const previousSnapshot = ctx.isCurrent() ? getRepoSnapshotQueryData(id, repoInstanceId) : null
          if (ctx.isCurrent()) setRepoSnapshotQueryData(id, repoInstanceId, snap)
          if (!snap) {
            updateIfFresh(set, id, repoInstanceId, (r) => {
              finishDataLoadError(r.dataLoads.snapshot, 'error.failed-read-repo')
              r.events = appendRepoEvent(r.events, errorEvent('error.failed-read-repo'))
            })
            return
          }
          await runSnapshotSuccessFlow(id, repoInstanceId, snap, previousSnapshot?.branches ?? null, ctx.isCurrent)
        },
        onError: (message) => {
          updateIfFresh(set, id, repoInstanceId, (r) => {
            if (isRepoUnavailableReason(message)) markRepoUnavailable(r, message)
            finishDataLoadError(r.dataLoads.snapshot, message)
            r.events = appendRepoEvent(r.events, errorEvent(message))
          })
        },
      })
    },

    async refreshStatus(id: string, options?: { repoInstanceId?: string }) {
      const resolved = resolveActionRepoInstanceId(get, id, options?.repoInstanceId)
      if (!resolved) return
      const { repoInstanceId } = resolved
      await runLatestDataLoadOperation({
        set,
        get,
        id,
        repoInstanceId,
        lane: 'read',
        operationKey: 'status',
        priority: 40,
        target: { key: 'status', reason: 'status' },
        selectDataLoad: (r) => r.dataLoads.status,
        start: (r) => ({ hasData: (getRepoStatusQueryData(r.id, r.instanceId)?.length ?? 0) > 0 }),
        task: (signal) => getRepoStatus(id, signal),
        onSuccess: (_status, ctx) => {
          if (ctx.isCurrent()) setRepoStatusQueryData(id, repoInstanceId, _status)
          const repoAfterStatus = get().repos[id]
          if (ctx.isCurrent()) persistRepoSnapshotCacheEntry(set, repoAfterStatus, repoInstanceId)
        },
        onError: (message, r) => {
          if (isRepoUnavailableReason(message)) markRepoUnavailable(r, message)
        },
        onErrorLog: (message) => {
          refreshStatusLog.warn('failed', { err: new Error(message) })
        },
      })
    },

    async refreshCoreData(id: string, options?: { repoInstanceId?: string }) {
      const resolved = resolveActionRepoInstanceId(get, id, options?.repoInstanceId)
      if (!resolved) return
      const { repoInstanceId } = resolved
      await runCoreDataRefreshWorkflow(get, { id, repoInstanceId })
    },

    /**
     * Combined snapshot + status refresh backed by the
     * `POST /api/repo/composite` endpoint. Saves a round trip on
     * initial repo load by folding the two core reads into one. Pull
     * requests are loaded only through the server runtime projection.
     */
    async refreshSnapshotAndStatus(id: string, options?: { skipLogBackfill?: boolean; repoInstanceId?: string }) {
      const resolved = resolveActionRepoInstanceId(get, id, options?.repoInstanceId)
      if (!resolved) return
      const { repoInstanceId } = resolved
      updateIfFresh(set, id, repoInstanceId, (r) => {
        startDataLoad(r.dataLoads.snapshot, { hasData: (readRepoBranchQueryProjection(r)?.branches.length ?? 0) > 0 })
        startDataLoad(r.dataLoads.status, { hasData: (getRepoStatusQueryData(r.id, r.instanceId)?.length ?? 0) > 0 })
      })
      await runLatestOperation({
        set,
        get,
        id,
        repoInstanceId,
        lane: 'read',
        operationKey: 'snapshot+status',
        priority: 50,
        targets: [
          { key: 'snapshot', reason: 'snapshot' },
          { key: 'status', reason: 'status' },
        ],
        task: (signal) => readRepoBulk(id, { include: ['snapshot', 'status'], signal }),
        errorFromResult: (result) => {
          // null on either side means soft-fail; treat as snapshot error
          // (status is allowed to be empty).
          return result.snapshot === null ? 'error.failed-read-repo' : null
        },
        onResult: async (result, ctx) => {
          const previousSnapshot = ctx.isCurrent() ? getRepoSnapshotQueryData(id, repoInstanceId) : null
          if (ctx.isCurrent()) setRepoBulkReadQueryData(id, repoInstanceId, ['snapshot', 'status'], result)
          // Apply status first (leaf, no follow-up).
          updateIfFresh(set, id, repoInstanceId, (r) => {
            // The composite started the status data load above but, unlike
            // snapshot which has a dedicated success flow that calls
            // finishDataLoadSuccess, status has no follow-up path. Without
            // this reset, the data load stays in 'loading'/'refreshing'
            // forever, blocking useRepoStatusRefresh's gate from firing
            // on the next status/changes tab open.
            finishDataLoadSuccess(r.dataLoads.status)
          })
          if (result.status.length > 0 && ctx.isCurrent()) {
            persistRepoSnapshotCacheEntry(set, get().repos[id], repoInstanceId)
          }
          if (result.snapshot === null) {
            updateIfFresh(set, id, repoInstanceId, (r) => {
              finishDataLoadError(r.dataLoads.snapshot, 'error.failed-read-repo')
              r.events = appendRepoEvent(r.events, errorEvent('error.failed-read-repo'))
            })
            return
          }
          await runSnapshotSuccessFlow(
            id,
            repoInstanceId,
            result.snapshot,
            previousSnapshot?.branches ?? null,
            ctx.isCurrent,
          )
        },
        onError: (message) => {
          updateIfFresh(set, id, repoInstanceId, (r) => {
            if (isRepoUnavailableReason(message)) markRepoUnavailable(r, message)
            finishDataLoadError(r.dataLoads.snapshot, message)
            finishDataLoadError(r.dataLoads.status, message)
            r.events = appendRepoEvent(r.events, errorEvent(message))
          })
        },
      })
    },

    /** Unified sync pipeline — local and remote repos follow the same path.
     *  1) Attempt a best-effort fetch when remotes are configured.
     *  2) Always refresh the local snapshot + status afterwards.
     *  Bookkeeping (setLastResult, clearFetchFailed) is handled inline
     *  so there is one source of truth for post-sync cleanup. */
    async syncAndRefresh(id: string, options?: { repoInstanceId?: string }) {
      const resolved = resolveActionRepoInstanceId(get, id, options?.repoInstanceId)
      if (!resolved) return
      const { repoInstanceId } = resolved
      await runExclusiveOperation({
        set,
        get,
        id,
        repoInstanceId,
        lane: 'read',
        priority: 100,
        targets: [{ key: 'manualRefresh', reason: 'manual-refresh' }],
        task: async () =>
          await runWithRepoInvalidationSource(
            'manual',
            async (sourceToken) => await runManualSyncPipeline(id, repoInstanceId, sourceToken),
          ),
      })
    },
  }
}
