import { appendRepoEvent, errorEvent } from '#/web/stores/repos/repo-state-factory.ts'
import { updateIfFresh } from '#/web/stores/repos/repo-guards.ts'
import { isRepoUnavailableReason, markRepoUnavailable } from '#/web/stores/repos/availability.ts'
import { runExclusiveOperation, runLatestOperation } from '#/web/stores/repos/operation-runner.ts'
import { resolveActionRepoRuntimeId } from '#/web/stores/repos/refresh-state.ts'
import { createRefreshSyncHelpers } from '#/web/stores/repos/refresh-sync.ts'
import { cancelDataLoad, finishDataLoadError, startDataLoad } from '#/web/stores/repos/repo-data-load-state.ts'
import { refreshRepoProjectionReadModel } from '#/web/repo-data-query.ts'
import { readRepoBranchSnapshotQueryProjection } from '#/web/repo-branch-read-model.ts'
import { acceptRepoProjectionReadModel } from '#/web/stores/repos/projection-read-model-effects.ts'
import { refreshRepoWorktreeStatus } from '#/web/stores/repos/worktree-status-refresh.ts'
import type { RepoRuntimeProjection } from '#/shared/api-types.ts'
import type { ReposGet, ReposSet } from '#/web/stores/repos/types.ts'
import { refreshWorkspace } from '#/web/repo-client.ts'

export interface RepoRefreshStoreAccess {
  set: ReposSet
  get: ReposGet
}

async function runRepoProjectionReadModelRefresh(
  store: RepoRefreshStoreAccess,
  id: string,
  repoRuntimeId: string,
): Promise<void> {
  updateIfFresh(store.set, id, repoRuntimeId, (r) => {
    startDataLoad(r.dataLoads.repoReadModel, {
      hasData: (readRepoBranchSnapshotQueryProjection(r)?.branches.length ?? 0) > 0,
    })
  })
  await runLatestOperation({
    set: store.set,
    get: store.get,
    id,
    repoRuntimeId,
    lane: 'read',
    operationKey: 'repo-read-model',
    priority: 50,
    targets: [{ key: 'repoReadModel', reason: 'repo-read-model' }],
    task: (signal) => refreshRepoProjectionReadModel(id, repoRuntimeId, null, 'full', { signal }),
    errorFromResult: (projection) => (projection.snapshot ? null : 'error.failed-read-repo'),
    onResult: (projection: RepoRuntimeProjection, ctx) => {
      if (!ctx.isCurrent()) return
      acceptRepoProjectionReadModel(
        store.set,
        store.get,
        { repoRoot: id, repoRuntimeId, projection },
        { scope: 'repo-read-model' },
      )
    },
    onError: (message, ctx) => {
      const ownsReadModelLoad = ctx.ownsTarget('repoReadModel')
      updateIfFresh(store.set, id, repoRuntimeId, (r) => {
        if (isRepoUnavailableReason(message)) markRepoUnavailable(r, message)
        if (ownsReadModelLoad) finishDataLoadError(r.dataLoads.repoReadModel, message)
        r.events = appendRepoEvent(r.events, errorEvent(message))
      })
    },
    onStale: (ctx) => {
      const ownsReadModelLoad = ctx.ownsTarget('repoReadModel')
      if (!ownsReadModelLoad) return
      updateIfFresh(store.set, id, repoRuntimeId, (r) => {
        if (ownsReadModelLoad) cancelDataLoad(r.dataLoads.repoReadModel)
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
  await Promise.all([
    runRepoProjectionReadModelRefresh(store, id, repoRuntimeId),
    refreshRepoWorktreeStatus(store, id, repoRuntimeId),
  ])
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
    task: async (signal) => {
      const refreshed = await refreshWorkspace(id, repoRuntimeId, signal)
      if (refreshed.kind === 'stale-runtime') throw new Error('error.repo-runtime-stale')
      if (refreshed.kind === 'failed') {
        const diagnostic = refreshed.probe.status === 'ready' ? refreshed.probe.diagnostics[0]?.message : undefined
        throw new Error(diagnostic ?? 'error.failed-read-repo')
      }
      updateIfFresh(store.set, id, repoRuntimeId, (repo) => {
        repo.workspaceProbe = refreshed.probe
      })
      if (
        refreshed.probe.status === 'ready' &&
        refreshed.probe.capabilities.git.status === 'unavailable'
      ) {
        return
      }
      await runManualSyncPipeline(id, repoRuntimeId)
    },
    onError: (message) => {
      updateIfFresh(store.set, id, repoRuntimeId, (repo) => {
        repo.events = appendRepoEvent(repo.events, errorEvent(message))
      })
    },
  })
}
