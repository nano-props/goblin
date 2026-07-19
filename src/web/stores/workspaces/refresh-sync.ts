import { isRepoUnavailable, updateIfFresh } from '#/web/stores/workspaces/workspace-guards.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { runExclusiveOperation } from '#/web/stores/workspaces/operation-runner.ts'
import {
  applyFetchDataLoadError,
  applyFetchDataLoadResult,
  canRunRemoteFetchNow,
  repoIfFresh,
  resolveActionWorkspaceRuntimeId,
  shouldAttemptFetch,
} from '#/web/stores/workspaces/refresh-state.ts'
import { startDataLoad } from '#/web/stores/workspaces/repo-data-load-state.ts'
import { canStartRemoteFetch } from '#/web/stores/workspaces/sync-state.ts'
import { waitForRepoOperationsIdle } from '#/web/stores/workspaces/repo-operation-scheduler.ts'
import { fetchRepo } from '#/web/repo-client.ts'
import type { RepoOperationReason } from '#/web/stores/workspaces/operations.ts'
import type { WorkspacesGet, WorkspacesSet } from '#/web/stores/workspaces/types.ts'
import type { ExecResult } from '#/web/types.ts'
import { gitWorkspaceProjection, isGitWorkspace } from '#/web/stores/workspaces/git-workspace-projection.ts'

export function createRefreshSyncHelpers(
  set: WorkspacesSet,
  get: WorkspacesGet,
  options: { refreshProjectionReadModel: (id: WorkspaceId, workspaceRuntimeId: string) => Promise<void> },
) {
  async function runNetworkTask(
    id: WorkspaceId,
    task: (signal: AbortSignal) => Promise<ExecResult>,
    options?: { workspaceRuntimeId?: string; reason?: RepoOperationReason; priority?: number },
  ): Promise<ExecResult | null> {
    const resolved = resolveActionWorkspaceRuntimeId(get, id, options?.workspaceRuntimeId)
    if (!resolved) return null
    const { repo: repoBefore, workspaceRuntimeId } = resolved
    if (!canRunRemoteFetchNow(repoBefore)) return { ok: false, message: 'error.network-op-in-progress' }
    updateIfFresh(set, id, workspaceRuntimeId, (r) => {
      if (!isGitWorkspace(r)) return
      const fetch = gitWorkspaceProjection(r).dataLoads.fetch
      startDataLoad(fetch, { hasData: fetch.loadedAt !== null })
    })
    return runExclusiveOperation({
      set,
      get,
      id,
      workspaceRuntimeId,
      lane: 'network',
      priority: options?.priority ?? 50,
      targets: [{ key: 'fetch', reason: options?.reason ?? 'network' }],
      canStart: canStartRemoteFetch,
      busyResult: { ok: false, message: 'error.network-op-in-progress' },
      task: (signal) => task(signal),
      errorFromResult: (result) => (!result.ok && result.message !== 'cancelled' ? result.message : null),
      onResult: (result) => {
        updateIfFresh(set, id, workspaceRuntimeId, (r) => {
          applyFetchDataLoadResult(r, result)
        })
      },
      onError: (message) => {
        updateIfFresh(set, id, workspaceRuntimeId, (r) => {
          applyFetchDataLoadError(r, message)
        })
      },
      rethrow: true,
    })
  }

  async function attemptFetch(id: WorkspaceId, workspaceRuntimeId: string): Promise<ExecResult | null> {
    let repo = repoIfFresh(get, id, workspaceRuntimeId)
    if (!repo || !shouldAttemptFetch(repo, workspaceRuntimeId)) return null
    if (!canStartRemoteFetch(repo)) {
      try {
        await waitForRepoOperationsIdle(id, ['repoReadModel'])
      } catch {
        return null
      }
      repo = repoIfFresh(get, id, workspaceRuntimeId)
      if (!repo || isRepoUnavailable(repo)) return null
      if (!canStartRemoteFetch(repo)) return null
    }
    try {
      return await runNetworkTask(id, (signal) => fetchRepo(id, workspaceRuntimeId, signal), {
        workspaceRuntimeId,
        reason: 'user-fetch',
        priority: 100,
      })
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
  }

  function finalizeSyncFetchResult(id: WorkspaceId, workspaceRuntimeId: string, fetchResult: ExecResult | null): void {
    if (!fetchResult) return
    if (fetchResult.ok) {
      get().clearFetchFailed(id, workspaceRuntimeId)
      return
    }
    if (fetchResult.message !== 'cancelled') get().setLastResult(id, fetchResult, workspaceRuntimeId)
  }

  async function runManualSyncPipeline(id: WorkspaceId, workspaceRuntimeId: string): Promise<void> {
    let fetchResult: ExecResult | null = null
    const repoBeforeFetch = repoIfFresh(get, id, workspaceRuntimeId)
    if (!repoBeforeFetch) return
    if (shouldAttemptFetch(repoBeforeFetch, workspaceRuntimeId)) {
      fetchResult = await attemptFetch(id, workspaceRuntimeId)
    }
    if (repoIfFresh(get, id, workspaceRuntimeId)) {
      await options.refreshProjectionReadModel(id, workspaceRuntimeId)
    }
    finalizeSyncFetchResult(id, workspaceRuntimeId, fetchResult)
  }

  return {
    runManualSyncPipeline,
  }
}
