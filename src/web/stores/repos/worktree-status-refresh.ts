import { refreshRepoWorktreeStatusReadModel } from '#/web/repo-data-query.ts'
import { refreshStatusLog } from '#/web/logger.ts'
import { isRepoUnavailable } from '#/web/stores/repos/repo-guards.ts'
import { isExpectedRepoOperationCancellation } from '#/web/stores/repos/operation-cancellation.ts'
import type { ReposGet } from '#/web/stores/repos/types.ts'

interface RepoWorktreeStatusRefreshAccess {
  get: ReposGet
}

function statusRefreshable(store: RepoWorktreeStatusRefreshAccess, repoRoot: string, workspaceRuntimeId: string): boolean {
  const repo = store.get().repos[repoRoot]
  return !!repo && repo.workspaceRuntimeId === workspaceRuntimeId && !isRepoUnavailable(repo)
}

export async function refreshRepoWorktreeStatus(
  store: RepoWorktreeStatusRefreshAccess,
  repoRoot: string,
  workspaceRuntimeId: string,
): Promise<void> {
  if (!statusRefreshable(store, repoRoot, workspaceRuntimeId)) return
  try {
    await refreshRepoWorktreeStatusReadModel(repoRoot, workspaceRuntimeId)
  } catch (err) {
    if (isExpectedRepoOperationCancellation(err)) return
    const message = err instanceof Error ? err.message : String(err)
    refreshStatusLog.warn('failed', { err: new Error(message) })
  }
}
