import { isRepoUnavailable, updateIfFresh } from '#/web/stores/repos/repo-guards.ts'
import { runExclusiveOperation } from '#/web/stores/repos/operation-runner.ts'
import {
  applyFetchDataLoadError,
  applyFetchDataLoadResult,
  canRunRemoteFetchNow,
  repoIfFresh,
  resolveActionRepoRuntimeId,
  shouldAttemptFetch,
} from '#/web/stores/repos/refresh-state.ts'
import { startDataLoad } from '#/web/stores/repos/repo-data-load-state.ts'
import { canStartRemoteFetch } from '#/web/stores/repos/sync-state.ts'
import { waitForRepoOperationsIdle } from '#/web/stores/repos/repo-operation-scheduler.ts'
import { fetchRepo } from '#/web/repo-client.ts'
import type { RepoOperationReason } from '#/web/stores/repos/operations.ts'
import type { ReposGet, ReposSet } from '#/web/stores/repos/types.ts'
import type { ExecResult } from '#/web/types.ts'

export function createRefreshSyncHelpers(
  set: ReposSet,
  get: ReposGet,
  options: { refreshProjectionReadModel: (id: string, repoRuntimeId: string) => Promise<void> },
) {
  async function runNetworkTask(
    id: string,
    task: (signal: AbortSignal) => Promise<ExecResult>,
    options?: { repoRuntimeId?: string; reason?: RepoOperationReason; priority?: number },
  ): Promise<ExecResult | null> {
    const resolved = resolveActionRepoRuntimeId(get, id, options?.repoRuntimeId)
    if (!resolved) return null
    const { repo: repoBefore, repoRuntimeId } = resolved
    if (!canRunRemoteFetchNow(repoBefore)) return { ok: false, message: 'error.network-op-in-progress' }
    updateIfFresh(set, id, repoRuntimeId, (r) => {
      startDataLoad(r.dataLoads.fetch, { hasData: r.dataLoads.fetch.loadedAt !== null })
    })
    return runExclusiveOperation({
      set,
      get,
      id,
      repoRuntimeId,
      lane: 'network',
      priority: options?.priority ?? 50,
      targets: [{ key: 'fetch', reason: options?.reason ?? 'network' }],
      canStart: canStartRemoteFetch,
      busyResult: { ok: false, message: 'error.network-op-in-progress' },
      task: (signal) => task(signal),
      errorFromResult: (result) => (!result.ok && result.message !== 'cancelled' ? result.message : null),
      onResult: (result) => {
        updateIfFresh(set, id, repoRuntimeId, (r) => {
          applyFetchDataLoadResult(r, result)
        })
      },
      onError: (message) => {
        updateIfFresh(set, id, repoRuntimeId, (r) => {
          applyFetchDataLoadError(r, message)
        })
      },
      rethrow: true,
    })
  }

  async function attemptFetch(id: string, repoRuntimeId: string): Promise<ExecResult | null> {
    let repo = repoIfFresh(get, id, repoRuntimeId)
    if (!repo || !shouldAttemptFetch(repo, repoRuntimeId)) return null
    if (!canStartRemoteFetch(repo)) {
      try {
        await waitForRepoOperationsIdle(id, ['repoReadModel', 'visibleStatus'])
      } catch {
        return null
      }
      repo = repoIfFresh(get, id, repoRuntimeId)
      if (!repo || isRepoUnavailable(repo)) return null
      if (!canStartRemoteFetch(repo)) return null
    }
    try {
      return await runNetworkTask(id, (signal) => fetchRepo(id, 'user', signal), {
        repoRuntimeId,
        reason: 'user-fetch',
        priority: 100,
      })
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
  }

  function finalizeSyncFetchResult(id: string, repoRuntimeId: string, fetchResult: ExecResult | null): void {
    if (!fetchResult) return
    if (fetchResult.ok) {
      get().clearFetchFailed(id, repoRuntimeId)
      return
    }
    if (fetchResult.message !== 'cancelled') get().setLastResult(id, fetchResult, repoRuntimeId)
  }

  async function runManualSyncPipeline(id: string, repoRuntimeId: string): Promise<void> {
    let fetchResult: ExecResult | null = null
    const repoBeforeFetch = repoIfFresh(get, id, repoRuntimeId)
    if (!repoBeforeFetch) return
    if (shouldAttemptFetch(repoBeforeFetch, repoRuntimeId)) {
      fetchResult = await attemptFetch(id, repoRuntimeId)
    }
    if (repoIfFresh(get, id, repoRuntimeId)) {
      await options.refreshProjectionReadModel(id, repoRuntimeId)
    }
    finalizeSyncFetchResult(id, repoRuntimeId, fetchResult)
  }

  return {
    runManualSyncPipeline,
  }
}
