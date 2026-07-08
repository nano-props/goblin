import { appendRepoEvent, errorEvent } from '#/web/stores/repos/repo-state-factory.ts'
import { updateIfFresh } from '#/web/stores/repos/repo-guards.ts'
import { refreshStatusLog } from '#/web/logger.ts'
import { isRepoUnavailableReason, markRepoUnavailable } from '#/web/stores/repos/availability.ts'
import { runExclusiveOperation, runLatestOperation } from '#/web/stores/repos/operation-runner.ts'
import { resolveActionRepoRuntimeId } from '#/web/stores/repos/refresh-state.ts'
import { createRefreshSyncHelpers } from '#/web/stores/repos/refresh-sync.ts'
import { finishDataLoadError, startDataLoad } from '#/web/stores/repos/repo-data-load-state.ts'
import { refreshRepoProjectionReadModel } from '#/web/repo-data-query.ts'
import { readRepoBranchQueryProjection } from '#/web/repo-branch-read-model.ts'
import { acceptRepoProjectionReadModel } from '#/web/stores/repos/projection-read-model-effects.ts'
import type { RepoRuntimeProjection } from '#/shared/api-types.ts'
import type {
  RepoRuntimeProjectionRefreshOptions,
  RepoRuntimeProjectionRefreshScope,
  ReposGet,
  ReposSet,
} from '#/web/stores/repos/types.ts'

export interface RepoRefreshStoreAccess {
  set: ReposSet
  get: ReposGet
}

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

async function runRuntimeProjectionRefresh(
  store: RepoRefreshStoreAccess,
  id: string,
  repoRuntimeId: string,
  options: RepoRuntimeProjectionRefreshOptions,
): Promise<void> {
  const { scope } = options
  const { wantsReadModelLoad, wantsVisibleStatusLoad, operationKey, priority, targets } = projectionRefreshPlan(scope)
  const branchName = scope === 'visible-status' ? options.branchName : null

  updateIfFresh(store.set, id, repoRuntimeId, (r) => {
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
    set: store.set,
    get: store.get,
    id,
    repoRuntimeId,
    lane: 'read',
    operationKey,
    priority,
    targets,
    task: (signal) => refreshRepoProjectionReadModel(id, repoRuntimeId, branchName, 'full', { signal }),
    errorFromResult: (projection) => (projection.snapshot ? null : 'error.failed-read-repo'),
    onResult: (projection: RepoRuntimeProjection, ctx) => {
      if (!ctx.isCurrent()) return
      acceptRepoProjectionReadModel(store.set, store.get, { repoRoot: id, repoRuntimeId, projection })
    },
    onError: (message) => {
      if (wantsVisibleStatusLoad && !wantsReadModelLoad) refreshStatusLog.warn('failed', { err: new Error(message) })
      updateIfFresh(store.set, id, repoRuntimeId, (r) => {
        if (isRepoUnavailableReason(message)) markRepoUnavailable(r, message)
        if (wantsReadModelLoad) finishDataLoadError(r.dataLoads.repoReadModel, message)
        if (wantsVisibleStatusLoad) finishDataLoadError(r.dataLoads.visibleStatus, message)
        r.events = appendRepoEvent(r.events, errorEvent(message))
      })
    },
  })
}

export async function requestRepoProjectionReadModelRefresh(
  store: RepoRefreshStoreAccess,
  id: string,
  options?: { repoRuntimeId?: string },
): Promise<void> {
  const resolved = resolveActionRepoRuntimeId(store.get, id, options?.repoRuntimeId)
  if (!resolved) return
  const { repoRuntimeId } = resolved
  await runRuntimeProjectionRefresh(store, id, repoRuntimeId, { repoRuntimeId, scope: 'repo-read-model' })
}

export async function requestRepoRuntimeProjectionRefresh(
  store: RepoRefreshStoreAccess,
  id: string,
  options: RepoRuntimeProjectionRefreshOptions,
): Promise<void> {
  const resolved = resolveActionRepoRuntimeId(store.get, id, options.repoRuntimeId)
  if (!resolved) return
  const { repoRuntimeId } = resolved
  await runRuntimeProjectionRefresh(store, id, repoRuntimeId, options)
}

/** Unified sync pipeline — local and remote repos follow the same path.
 *  1) Attempt a best-effort fetch when remotes are configured.
 *  2) Always refresh the server runtime projection afterwards.
 *  Bookkeeping (setLastResult, clearFetchFailed) is handled inline
 *  so there is one source of truth for post-sync cleanup. */
export async function runManualRepoSync(
  store: RepoRefreshStoreAccess,
  id: string,
  options?: { repoRuntimeId?: string },
): Promise<void> {
  const resolved = resolveActionRepoRuntimeId(store.get, id, options?.repoRuntimeId)
  if (!resolved) return
  const { repoRuntimeId } = resolved
  const { runManualSyncPipeline } = createRefreshSyncHelpers(store.set, store.get, {
    refreshProjectionReadModel: async (repoId, nextRepoRuntimeId) => {
      await requestRepoProjectionReadModelRefresh(store, repoId, { repoRuntimeId: nextRepoRuntimeId })
    },
  })
  await runExclusiveOperation({
    set: store.set,
    get: store.get,
    id,
    repoRuntimeId,
    lane: 'read',
    priority: 100,
    targets: [{ key: 'manualRefresh', reason: 'manual-refresh' }],
    task: async () => await runManualSyncPipeline(id, repoRuntimeId),
  })
}
