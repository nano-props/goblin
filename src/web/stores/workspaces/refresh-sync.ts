import { workspaceCanExecute } from '#/web/stores/workspaces/workspace-guards.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { runExclusiveOperation } from '#/web/stores/workspaces/operation-runner.ts'
import {
  canRunRemoteFetchNow,
  repoIfFresh,
  resolveActionWorkspaceRuntimeId,
  shouldAttemptFetch,
} from '#/web/stores/workspaces/refresh-state.ts'
import { canStartRemoteFetch } from '#/web/stores/workspaces/sync-state.ts'
import { fetchRepo } from '#/web/repo-client.ts'
import type { RepoOperationReason } from '#/web/stores/workspaces/operations.ts'
import type { WorkspacesGet, WorkspacesSet } from '#/web/stores/workspaces/types.ts'
import type { RepoMutationExecResult } from '#/shared/git-types.ts'

export function refreshFailureMessage(result: RepoMutationExecResult): string | null {
  if (result.ok) return null
  if (result.message !== 'cancelled') return result.message
  return result.recoveryMessageKeys?.[0] ?? null
}

export function createRefreshSyncHelpers(
  set: WorkspacesSet,
  get: WorkspacesGet,
  options: { refreshReadModels: (id: WorkspaceId, workspaceRuntimeId: string, signal: AbortSignal) => Promise<void> },
) {
  async function runNetworkTask(
    id: WorkspaceId,
    task: (signal: AbortSignal) => Promise<RepoMutationExecResult>,
    options?: { workspaceRuntimeId?: string; reason?: RepoOperationReason; priority?: number },
  ): Promise<RepoMutationExecResult | null> {
    const resolved = resolveActionWorkspaceRuntimeId(get, id, options?.workspaceRuntimeId)
    if (!resolved) return null
    const { repo: repoBefore, workspaceRuntimeId } = resolved
    if (!canRunRemoteFetchNow(repoBefore)) return { ok: false, message: 'error.network-op-in-progress' }
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
      errorFromResult: refreshFailureMessage,
      rethrow: true,
    })
  }

  async function attemptFetch(id: WorkspaceId, workspaceRuntimeId: string): Promise<RepoMutationExecResult | null> {
    let repo = repoIfFresh(get, id, workspaceRuntimeId)
    if (!repo || !shouldAttemptFetch(repo, workspaceRuntimeId)) return null
    if (!canStartRemoteFetch(repo)) {
      repo = repoIfFresh(get, id, workspaceRuntimeId)
      if (!repo || !workspaceCanExecute(repo)) return null
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

  function finalizeSyncFetchResult(
    id: WorkspaceId,
    workspaceRuntimeId: string,
    fetchResult: RepoMutationExecResult | null,
  ): void {
    if (!fetchResult) return
    if (refreshFailureMessage(fetchResult)) get().setLastResult(id, fetchResult, workspaceRuntimeId)
  }

  async function runRefreshSyncPipeline(
    id: WorkspaceId,
    workspaceRuntimeId: string,
    signal: AbortSignal,
  ): Promise<void> {
    const repoBeforeFetch = repoIfFresh(get, id, workspaceRuntimeId)
    if (!repoBeforeFetch) return
    if (shouldAttemptFetch(repoBeforeFetch, workspaceRuntimeId)) {
      const fetchResult = await attemptFetch(id, workspaceRuntimeId)
      finalizeSyncFetchResult(id, workspaceRuntimeId, fetchResult)
    }
    if (repoIfFresh(get, id, workspaceRuntimeId)) {
      await options.refreshReadModels(id, workspaceRuntimeId, signal)
    }
  }

  return {
    runRefreshSyncPipeline,
  }
}
