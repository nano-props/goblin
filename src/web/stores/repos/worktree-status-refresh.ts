import { refreshRepoWorktreeStatusReadModel } from '#/web/repo-data-query.ts'
import { refreshStatusLog } from '#/web/logger.ts'
import { isRepoUnavailableReason, markRepoUnavailable } from '#/web/stores/repos/availability.ts'
import { isRepoUnavailable, updateIfFresh } from '#/web/stores/repos/repo-guards.ts'
import type { RepoRefreshStoreAccess } from '#/web/stores/repos/refresh.ts'

function statusRefreshable(store: RepoRefreshStoreAccess, repoRoot: string, repoRuntimeId: string): boolean {
  const repo = store.get().repos[repoRoot]
  return !!repo && repo.repoRuntimeId === repoRuntimeId && !isRepoUnavailable(repo)
}

export async function refreshRepoWorktreeStatus(
  store: RepoRefreshStoreAccess,
  repoRoot: string,
  repoRuntimeId: string,
): Promise<void> {
  if (!statusRefreshable(store, repoRoot, repoRuntimeId)) return
  try {
    await refreshRepoWorktreeStatusReadModel(repoRoot, repoRuntimeId)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    refreshStatusLog.warn('failed', { err: new Error(message) })
    updateIfFresh(store.set, repoRoot, repoRuntimeId, (repo) => {
      if (isRepoUnavailableReason(message)) markRepoUnavailable(repo, message)
    })
  }
}
