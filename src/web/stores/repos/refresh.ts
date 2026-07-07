import { appendRepoEvent, errorEvent } from '#/web/stores/repos/repo-state-factory.ts'
import { updateIfFresh } from '#/web/stores/repos/repo-guards.ts'
import { refreshStatusLog } from '#/web/logger.ts'
import { isRepoUnavailableReason, markRepoUnavailable } from '#/web/stores/repos/availability.ts'
import { runExclusiveOperation, runLatestOperation } from '#/web/stores/repos/operation-runner.ts'
import { persistRepoSnapshotCacheEntry } from '#/web/stores/repos/persistence.ts'
import { runCoreDataRefreshWorkflow, runSnapshotSuccessWorkflow } from '#/web/stores/repos/refresh-workflows.ts'
import {
  applySnapshotToRepoProjection,
  resolveActionRepoInstanceId,
} from '#/web/stores/repos/refresh-state.ts'
import { createRefreshSyncHelpers } from '#/web/stores/repos/refresh-sync.ts'
import { runWithRepoInvalidationSource } from '#/web/stores/repos/invalidation-sources.ts'
import { finishDataLoadError, finishDataLoadSuccess, startDataLoad } from '#/web/stores/repos/repo-data-load-state.ts'
import { getRepoProjection } from '#/web/repo-client.ts'
import {
  getRepoSnapshotQueryData,
  getRepoStatusQueryData,
  setRepoProjectionQueryData,
} from '#/web/repo-data-query.ts'
import { readRepoBranchQueryProjection } from '#/web/repo-branch-read-model.ts'
import type { RepoRuntimeProjection, RepoSnapshot } from '#/shared/api-types.ts'
import type { RepoRuntimeProjectionRefreshSection, ReposGet, ReposSet } from '#/web/stores/repos/types.ts'

type ProjectionRefreshTarget = {
  key: RepoRuntimeProjectionRefreshSection
  reason: RepoRuntimeProjectionRefreshSection
}

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

  async function runRuntimeProjectionRefresh(
    id: string,
    repoInstanceId: string,
    sections: readonly RepoRuntimeProjectionRefreshSection[],
  ): Promise<void> {
    const wantsSnapshot = sections.includes('snapshot')
    const wantsStatus = sections.includes('status')
    if (!wantsSnapshot && !wantsStatus) return
    const operationKey = wantsSnapshot && wantsStatus ? 'snapshot+status' : wantsSnapshot ? 'snapshot' : 'status'
    const targets: [ProjectionRefreshTarget, ...ProjectionRefreshTarget[]] =
      wantsSnapshot && wantsStatus
        ? [
            { key: 'snapshot', reason: 'snapshot' },
            { key: 'status', reason: 'status' },
          ]
        : wantsSnapshot
          ? [{ key: 'snapshot', reason: 'snapshot' }]
          : [{ key: 'status', reason: 'status' }]

    updateIfFresh(set, id, repoInstanceId, (r) => {
      if (wantsSnapshot) {
        startDataLoad(r.dataLoads.snapshot, { hasData: (readRepoBranchQueryProjection(r)?.branches.length ?? 0) > 0 })
      }
      if (wantsStatus) {
        startDataLoad(r.dataLoads.status, { hasData: (getRepoStatusQueryData(r.id, r.instanceId)?.length ?? 0) > 0 })
      }
    })
    await runLatestOperation({
      set,
      get,
      id,
      repoInstanceId,
      lane: 'read',
      operationKey,
      priority: wantsSnapshot ? 50 : 40,
      targets,
      task: (signal) => getRepoProjection(id, null, { mode: 'full' }, signal),
      errorFromResult: (projection) => (projection.snapshot ? null : 'error.failed-read-repo'),
      onResult: async (projection: RepoRuntimeProjection, ctx) => {
        const previousSnapshot = ctx.isCurrent() ? getRepoSnapshotQueryData(id, repoInstanceId) : null
        if (ctx.isCurrent()) setRepoProjectionQueryData(id, repoInstanceId, null, 'full', projection)

        if (wantsStatus) {
          updateIfFresh(set, id, repoInstanceId, (r) => {
            if (projection.snapshot) finishDataLoadSuccess(r.dataLoads.status)
            else finishDataLoadError(r.dataLoads.status, 'error.failed-read-repo')
          })
        }
        if (projection.status.length > 0 && ctx.isCurrent()) {
          persistRepoSnapshotCacheEntry(set, get().repos[id], repoInstanceId)
        }
        if (!projection.snapshot) {
          updateIfFresh(set, id, repoInstanceId, (r) => {
            if (wantsSnapshot) finishDataLoadError(r.dataLoads.snapshot, 'error.failed-read-repo')
            r.events = appendRepoEvent(r.events, errorEvent('error.failed-read-repo'))
          })
          return
        }
        if (wantsSnapshot) {
          await runSnapshotSuccessFlow(
            id,
            repoInstanceId,
            projection.snapshot,
            previousSnapshot?.branches ?? null,
            ctx.isCurrent,
          )
        }
      },
      onError: (message) => {
        if (wantsStatus && !wantsSnapshot) refreshStatusLog.warn('failed', { err: new Error(message) })
        updateIfFresh(set, id, repoInstanceId, (r) => {
          if (isRepoUnavailableReason(message)) markRepoUnavailable(r, message)
          if (wantsSnapshot) finishDataLoadError(r.dataLoads.snapshot, message)
          if (wantsStatus) finishDataLoadError(r.dataLoads.status, message)
          r.events = appendRepoEvent(r.events, errorEvent(message))
        })
      },
    })
  }

  return {
    async refreshSnapshot(id: string, options?: { skipLogBackfill?: boolean; repoInstanceId?: string }) {
      const resolved = resolveActionRepoInstanceId(get, id, options?.repoInstanceId)
      if (!resolved) return
      const { repoInstanceId } = resolved
      await runRuntimeProjectionRefresh(id, repoInstanceId, ['snapshot'])
    },

    async refreshStatus(id: string, options?: { repoInstanceId?: string }) {
      const resolved = resolveActionRepoInstanceId(get, id, options?.repoInstanceId)
      if (!resolved) return
      const { repoInstanceId } = resolved
      await runRuntimeProjectionRefresh(id, repoInstanceId, ['status'])
    },

    async refreshCoreData(id: string, options?: { repoInstanceId?: string }) {
      const resolved = resolveActionRepoInstanceId(get, id, options?.repoInstanceId)
      if (!resolved) return
      const { repoInstanceId } = resolved
      await runCoreDataRefreshWorkflow(get, { id, repoInstanceId })
    },

    /**
     * Combined snapshot + status refresh backed by the server runtime
     * projection. The store method name is kept as the local intent API,
     * but the frontend no longer calls snapshot/status/composite reads.
     */
    async refreshSnapshotAndStatus(id: string, options?: { skipLogBackfill?: boolean; repoInstanceId?: string }) {
      const resolved = resolveActionRepoInstanceId(get, id, options?.repoInstanceId)
      if (!resolved) return
      const { repoInstanceId } = resolved
      await runRuntimeProjectionRefresh(id, repoInstanceId, ['snapshot', 'status'])
    },

    async refreshRuntimeProjection(
      id: string,
      options: { repoInstanceId?: string; sections: readonly RepoRuntimeProjectionRefreshSection[] },
    ) {
      const resolved = resolveActionRepoInstanceId(get, id, options.repoInstanceId)
      if (!resolved) return
      const { repoInstanceId } = resolved
      await runRuntimeProjectionRefresh(id, repoInstanceId, options.sections)
    },

    /** Unified sync pipeline — local and remote repos follow the same path.
     *  1) Attempt a best-effort fetch when remotes are configured.
     *  2) Always refresh the server runtime projection afterwards.
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
