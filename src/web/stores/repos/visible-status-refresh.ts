import {
  getRepoWorktreeStatusQueryData,
  refreshRepoWorktreeStatusReadModel,
} from '#/web/repo-data-query.ts'
import { refreshStatusLog } from '#/web/logger.ts'
import { isRepoUnavailableReason, markRepoUnavailable } from '#/web/stores/repos/availability.ts'
import { finishDataLoadError, finishDataLoadSuccess, startDataLoad } from '#/web/stores/repos/repo-data-load-state.ts'
import { isRepoUnavailable, updateIfFresh } from '#/web/stores/repos/repo-guards.ts'
import type { RepoRefreshStoreAccess } from '#/web/stores/repos/refresh.ts'

// Tab-open and visibility refreshes stay outside the operation lane so they
// cannot be stalled behind branch actions. React Query owns transport
// deduplication and stale-result rejection; this set only coalesces the
// matching presentation load state.
const visibleStatusRefreshesInFlight = new Set<string>()

function visibleStatusRefreshKey(repoRoot: string, repoRuntimeId: string): string {
  return [repoRoot, repoRuntimeId].join('\0')
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
): Promise<void> {
  if (!visibleStatusRefreshable(store, repoRoot, repoRuntimeId)) return
  const key = visibleStatusRefreshKey(repoRoot, repoRuntimeId)
  if (visibleStatusRefreshesInFlight.has(key)) return
  visibleStatusRefreshesInFlight.add(key)
  updateIfFresh(store.set, repoRoot, repoRuntimeId, (repo) => {
    startDataLoad(repo.dataLoads.visibleStatus, {
      hasData: !!getRepoWorktreeStatusQueryData(repoRoot, repoRuntimeId),
    })
  })
  try {
    const snapshot = await refreshRepoWorktreeStatusReadModel(repoRoot, repoRuntimeId)
    const repo = store.get().repos[repoRoot]
    if (!repo || repo.repoRuntimeId !== repoRuntimeId) return
    updateIfFresh(store.set, repoRoot, repoRuntimeId, (current) => {
      finishDataLoadSuccess(current.dataLoads.visibleStatus, snapshot.loadedAt)
    })
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
