import { isRepoUnavailable, updateIfFresh } from '#/web/stores/repos/repo-guards.ts'
import { runExclusiveOperation } from '#/web/stores/repos/operation-runner.ts'
import {
  applyFetchDataLoadError,
  applyFetchDataLoadResult,
  canRunRemoteFetchNow,
  repoIfFresh,
  resolveActionRepoInstanceId,
  shouldAttemptFetch,
} from '#/web/stores/repos/refresh-state.ts'
import { startDataLoad } from '#/web/stores/repos/repo-data-load-state.ts'
import { canStartRemoteFetch } from '#/web/stores/repos/sync-state.ts'
import { waitForRepoOperationsIdle } from '#/web/stores/repos/repo-operation-scheduler.ts'
import { fetchRepo } from '#/web/repo-client.ts'
import { invalidateRepoRuntimeProjectionQueries } from '#/web/repo-data-query.ts'
import type { RepoOperationReason } from '#/web/stores/repos/operations.ts'
import type { ReposGet, ReposSet } from '#/web/stores/repos/types.ts'
import type { ExecResult } from '#/web/types.ts'

export function createRefreshSyncHelpers(set: ReposSet, get: ReposGet) {
  async function runNetworkTask(
    id: string,
    task: (signal: AbortSignal) => Promise<ExecResult>,
    options?: { repoInstanceId?: string; reason?: RepoOperationReason; priority?: number },
  ): Promise<ExecResult | null> {
    const resolved = resolveActionRepoInstanceId(get, id, options?.repoInstanceId)
    if (!resolved) return null
    const { repo: repoBefore, repoInstanceId } = resolved
    if (!canRunRemoteFetchNow(repoBefore)) return { ok: false, message: 'error.network-op-in-progress' }
    updateIfFresh(set, id, repoInstanceId, (r) => {
      startDataLoad(r.dataLoads.fetch, { hasData: r.dataLoads.fetch.loadedAt !== null })
    })
    invalidateRepoRuntimeProjectionQueries(id, repoInstanceId)
    return runExclusiveOperation({
      set,
      get,
      id,
      repoInstanceId,
      lane: 'network',
      priority: options?.priority ?? 50,
      targets: [{ key: 'fetch', reason: options?.reason ?? 'network' }],
      canStart: canStartRemoteFetch,
      busyResult: { ok: false, message: 'error.network-op-in-progress' },
      task: (signal) => {
        const work = task(signal)
        invalidateRepoRuntimeProjectionQueries(id, repoInstanceId)
        return work
      },
      errorFromResult: (result) => (!result.ok && result.message !== 'cancelled' ? result.message : null),
      onResult: (result) => {
        invalidateRepoRuntimeProjectionQueries(id, repoInstanceId)
        updateIfFresh(set, id, repoInstanceId, (r) => {
          applyFetchDataLoadResult(r, result)
        })
      },
      onError: (message) => {
        invalidateRepoRuntimeProjectionQueries(id, repoInstanceId)
        updateIfFresh(set, id, repoInstanceId, (r) => {
          applyFetchDataLoadError(r, message)
        })
      },
      rethrow: true,
    })
  }

  async function attemptFetch(id: string, repoInstanceId: string): Promise<ExecResult | null> {
    let repo = repoIfFresh(get, id, repoInstanceId)
    if (!repo || !shouldAttemptFetch(repo, repoInstanceId)) return null
    if (!canStartRemoteFetch(repo)) {
      try {
        await waitForRepoOperationsIdle(id, ['repoReadModel', 'visibleStatus'])
      } catch {
        return null
      }
      repo = repoIfFresh(get, id, repoInstanceId)
      if (!repo || isRepoUnavailable(repo)) return null
      if (!canStartRemoteFetch(repo)) return null
    }
    try {
      return await runNetworkTask(id, (signal) => fetchRepo(id, 'user', signal), {
        repoInstanceId,
        reason: 'user-fetch',
        priority: 100,
      })
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
  }

  function finalizeSyncFetchResult(id: string, repoInstanceId: string, fetchResult: ExecResult | null): void {
    if (!fetchResult) return
    if (fetchResult.ok) {
      get().clearFetchFailed(id, repoInstanceId)
      return
    }
    if (fetchResult.message !== 'cancelled') get().setLastResult(id, fetchResult, repoInstanceId)
  }

  async function runManualSyncPipeline(id: string, repoInstanceId: string): Promise<void> {
    let fetchResult: ExecResult | null = null
    const repoBeforeFetch = repoIfFresh(get, id, repoInstanceId)
    if (!repoBeforeFetch) return
    if (shouldAttemptFetch(repoBeforeFetch, repoInstanceId)) {
      fetchResult = await attemptFetch(id, repoInstanceId)
    }
    if (repoIfFresh(get, id, repoInstanceId)) {
      await get().refreshCoreData(id, { repoInstanceId })
    }
    finalizeSyncFetchResult(id, repoInstanceId, fetchResult)
  }

  return {
    runManualSyncPipeline,
  }
}
