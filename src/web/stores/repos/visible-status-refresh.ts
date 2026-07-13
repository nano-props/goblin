import { getRepoProjection } from '#/web/repo-client.ts'
import { repoProjectionQueryKey, setRepoProjectionQueryData } from '#/web/repo-data-query.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { refreshStatusLog } from '#/web/logger.ts'
import { isRepoUnavailableReason, markRepoUnavailable } from '#/web/stores/repos/availability.ts'
import { finishDataLoadError, startDataLoad } from '#/web/stores/repos/repo-data-load-state.ts'
import { isRepoUnavailable, updateIfFresh } from '#/web/stores/repos/repo-guards.ts'
import { readRepoBranchQueryProjection } from '#/web/repo-branch-read-model.ts'
import { acceptRepoProjectionReadModel } from '#/web/stores/repos/projection-read-model-effects.ts'
import type { RepoRefreshStoreAccess } from '#/web/stores/repos/refresh.ts'

const visibleStatusRefreshesInFlight = new Set<string>()

function visibleStatusRefreshKey(repoRoot: string, repoRuntimeId: string, branchName: string): string {
  return [repoRoot, repoRuntimeId, branchName].join('\0')
}

function matchingProjectionFetchInProgress(repoRoot: string, repoRuntimeId: string, branchName: string): boolean {
  const queryKey = repoProjectionQueryKey(repoRoot, repoRuntimeId, branchName, 'full')
  const fetchStatus = primaryWindowQueryClient.getQueryState(queryKey)?.fetchStatus
  return fetchStatus === 'fetching' || fetchStatus === 'paused'
}

function visibleStatusRefreshable(store: RepoRefreshStoreAccess, repoRoot: string, repoRuntimeId: string): boolean {
  const repo = store.get().repos[repoRoot]
  return (
    !!repo &&
    repo.repoRuntimeId === repoRuntimeId &&
    !isRepoUnavailable(repo) &&
    repo.dataLoads.visibleStatus.phase === 'idle'
  )
}

export function resetVisibleStatusRefreshStateForTest(): void {
  visibleStatusRefreshesInFlight.clear()
}

export async function refreshVisibleStatusCache(
  store: RepoRefreshStoreAccess,
  repoRoot: string,
  repoRuntimeId: string,
  branchName: string,
): Promise<void> {
  if (!visibleStatusRefreshable(store, repoRoot, repoRuntimeId)) return
  const key = visibleStatusRefreshKey(repoRoot, repoRuntimeId, branchName)
  if (
    visibleStatusRefreshesInFlight.has(key) ||
    matchingProjectionFetchInProgress(repoRoot, repoRuntimeId, branchName)
  ) {
    return
  }
  visibleStatusRefreshesInFlight.add(key)
  updateIfFresh(store.set, repoRoot, repoRuntimeId, (repo) => {
    startDataLoad(repo.dataLoads.visibleStatus, {
      hasData: (readRepoBranchQueryProjection(repo)?.status.length ?? 0) > 0,
    })
  })
  try {
    const projection = await getRepoProjection(repoRoot, repoRuntimeId, branchName, { mode: 'full' })
    const repo = store.get().repos[repoRoot]
    if (!repo || repo.repoRuntimeId !== repoRuntimeId) return
    setRepoProjectionQueryData(repoRoot, repoRuntimeId, branchName, 'full', projection)
    acceptRepoProjectionReadModel(
      store.set,
      store.get,
      { repoRoot, repoRuntimeId, projection },
      { scope: 'visible-status', settleVisibleStatus: true },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    refreshStatusLog.warn('failed', { err: new Error(message) })
    updateIfFresh(store.set, repoRoot, repoRuntimeId, (repo) => {
      if (isRepoUnavailableReason(message)) markRepoUnavailable(repo, message)
      finishDataLoadError(repo.dataLoads.visibleStatus, message)
    })
  } finally {
    visibleStatusRefreshesInFlight.delete(key)
  }
}
