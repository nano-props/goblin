import { refreshRepoWorktreeStatusReadModel } from '#/web/repo-data-query.ts'
import { refreshStatusLog } from '#/web/logger.ts'
import { isRepoUnavailable } from '#/web/stores/repos/repo-guards.ts'
import type { ReposGet } from '#/web/stores/repos/types.ts'

interface RepoWorktreeStatusRefreshAccess {
  get: ReposGet
}

function statusRefreshable(store: RepoWorktreeStatusRefreshAccess, repoRoot: string, repoRuntimeId: string): boolean {
  const repo = store.get().repos[repoRoot]
  return !!repo && repo.repoRuntimeId === repoRuntimeId && !isRepoUnavailable(repo)
}

export async function refreshRepoWorktreeStatus(
  store: RepoWorktreeStatusRefreshAccess,
  repoRoot: string,
  repoRuntimeId: string,
): Promise<void> {
  if (!statusRefreshable(store, repoRoot, repoRuntimeId)) return
  try {
    await refreshRepoWorktreeStatusReadModel(repoRoot, repoRuntimeId)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    refreshStatusLog.warn('failed', { err: new Error(message) })
  }
}
