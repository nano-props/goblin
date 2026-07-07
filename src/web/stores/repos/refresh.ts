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
import { setRepoProjectionQueryData } from '#/web/repo-data-query.ts'
import { readRepoBranchQueryProjection } from '#/web/repo-branch-read-model.ts'
import type { RepoRuntimeProjection, RepoSnapshot } from '#/shared/api-types.ts'
import type { RepoRuntimeProjectionRefreshScope, ReposGet, ReposSet } from '#/web/stores/repos/types.ts'

type ProjectionRefreshTarget =
  | { key: 'repoReadModel'; reason: 'repo-read-model' }
  | { key: 'visibleStatus'; reason: 'visible-status' }

interface ProjectionRefreshPlan {
  wantsReadModelLoad: boolean
  wantsVisibleStatusLoad: boolean
  operationKey: string
  priority: number
  targets: [ProjectionRefreshTarget, ...ProjectionRefreshTarget[]]
}

function projectionRefreshPlan(scope: RepoRuntimeProjectionRefreshScope): ProjectionRefreshPlan {
  switch (scope) {
    case 'repo-read-model':
      return {
        wantsReadModelLoad: true,
        wantsVisibleStatusLoad: true,
        operationKey: 'repo-read-model',
        priority: 50,
        targets: [
          { key: 'repoReadModel', reason: 'repo-read-model' },
          { key: 'visibleStatus', reason: 'visible-status' },
        ],
      }
    case 'visible-status':
      return {
        wantsReadModelLoad: false,
        wantsVisibleStatusLoad: true,
        operationKey: 'visible-status',
        priority: 40,
        targets: [{ key: 'visibleStatus', reason: 'visible-status' }],
      }
  }
  const exhaustive: never = scope
  return exhaustive
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
    scope: RepoRuntimeProjectionRefreshScope,
  ): Promise<void> {
    const { wantsReadModelLoad, wantsVisibleStatusLoad, operationKey, priority, targets } = projectionRefreshPlan(scope)

    updateIfFresh(set, id, repoInstanceId, (r) => {
      if (wantsReadModelLoad) {
        startDataLoad(r.dataLoads.repoReadModel, {
          hasData: (readRepoBranchQueryProjection(r)?.branches.length ?? 0) > 0,
        })
      }
      if (wantsVisibleStatusLoad) {
        startDataLoad(r.dataLoads.visibleStatus, {
          hasData: (readRepoBranchQueryProjection(r)?.status.length ?? 0) > 0,
        })
      }
    })
    await runLatestOperation({
      set,
      get,
      id,
      repoInstanceId,
      lane: 'read',
      operationKey,
      priority,
      targets,
      task: (signal) => getRepoProjection(id, null, { mode: 'full' }, signal),
      errorFromResult: (projection) => (projection.snapshot ? null : 'error.failed-read-repo'),
      onResult: async (projection: RepoRuntimeProjection, ctx) => {
        const previousBranchModel = ctx.isCurrent()
          ? readRepoBranchQueryProjection({ id, instanceId: repoInstanceId })
          : null
        if (ctx.isCurrent()) setRepoProjectionQueryData(id, repoInstanceId, null, 'full', projection)

        if (wantsVisibleStatusLoad) {
          updateIfFresh(set, id, repoInstanceId, (r) => {
            if (projection.snapshot) finishDataLoadSuccess(r.dataLoads.visibleStatus)
            else finishDataLoadError(r.dataLoads.visibleStatus, 'error.failed-read-repo')
          })
        }
        if (projection.status.length > 0 && ctx.isCurrent()) {
          persistRepoSnapshotCacheEntry(set, get().repos[id], repoInstanceId)
        }
        if (!projection.snapshot) {
          updateIfFresh(set, id, repoInstanceId, (r) => {
            if (wantsReadModelLoad) finishDataLoadError(r.dataLoads.repoReadModel, 'error.failed-read-repo')
            r.events = appendRepoEvent(r.events, errorEvent('error.failed-read-repo'))
          })
          return
        }
        if (wantsReadModelLoad) {
          await runSnapshotSuccessFlow(
            id,
            repoInstanceId,
            projection.snapshot,
            previousBranchModel?.branches ?? null,
            ctx.isCurrent,
          )
        }
      },
      onError: (message) => {
        if (wantsVisibleStatusLoad && !wantsReadModelLoad) refreshStatusLog.warn('failed', { err: new Error(message) })
        updateIfFresh(set, id, repoInstanceId, (r) => {
          if (isRepoUnavailableReason(message)) markRepoUnavailable(r, message)
          if (wantsReadModelLoad) finishDataLoadError(r.dataLoads.repoReadModel, message)
          if (wantsVisibleStatusLoad) finishDataLoadError(r.dataLoads.visibleStatus, message)
          r.events = appendRepoEvent(r.events, errorEvent(message))
        })
      },
    })
  }

  return {
    async refreshCoreData(id: string, options?: { repoInstanceId?: string }) {
      const resolved = resolveActionRepoInstanceId(get, id, options?.repoInstanceId)
      if (!resolved) return
      const { repoInstanceId } = resolved
      await runCoreDataRefreshWorkflow(get, { id, repoInstanceId })
    },

    async refreshRuntimeProjection(
      id: string,
      options: { repoInstanceId?: string; scope: RepoRuntimeProjectionRefreshScope },
    ) {
      const resolved = resolveActionRepoInstanceId(get, id, options.repoInstanceId)
      if (!resolved) return
      const { repoInstanceId } = resolved
      await runRuntimeProjectionRefresh(id, repoInstanceId, options.scope)
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
