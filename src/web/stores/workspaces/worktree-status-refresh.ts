import { refreshRepoWorktreeStatusReadModel } from '#/web/repo-data-query.ts'
import { refreshStatusLog } from '#/web/logger.ts'
import { workspaceCanExecute } from '#/web/stores/workspaces/workspace-guards.ts'
import { isExpectedRepoOperationCancellation } from '#/web/stores/workspaces/operation-cancellation.ts'
import type { WorkspacesGet } from '#/web/stores/workspaces/types.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

interface RepoWorktreeStatusRefreshAccess {
  get: WorkspacesGet
}

function statusRefreshable(
  store: RepoWorktreeStatusRefreshAccess,
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
): boolean {
  const repo = store.get().workspaces[repoRoot]
  return !!repo && repo.workspaceRuntimeId === workspaceRuntimeId && workspaceCanExecute(repo)
}

export async function refreshRepoWorktreeStatus(
  store: RepoWorktreeStatusRefreshAccess,
  repoRoot: WorkspaceId,
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
