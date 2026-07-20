import type { RepoQueryInvalidationEvent } from '#/shared/repo-query-invalidation.ts'
import { invalidateRepoDataQueries, invalidateRepoRuntimeProjectionQueries } from '#/web/repo-data-query.ts'
import { gitWorkspaceCanExecute } from '#/web/stores/workspaces/workspace-guards.ts'
import type { RepoRefreshStoreAccess } from '#/web/stores/workspaces/refresh.ts'
import { refreshRepoWorktreeStatus } from '#/web/stores/workspaces/worktree-status-refresh.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

export function requestVisibleWorkspaceStatusRefresh(
  store: RepoRefreshStoreAccess,
  id: WorkspaceId,
  workspaceRuntimeId: string,
  branchName: string | null,
): boolean {
  const repo = store.get().workspaces[id]
  if (!repo || repo.workspaceRuntimeId !== workspaceRuntimeId || !branchName) return false
  if (!gitWorkspaceCanExecute(repo)) return false
  void refreshRepoWorktreeStatus(store, id, workspaceRuntimeId)
  return true
}

export async function handleRepoInvalidationRefresh(
  store: RepoRefreshStoreAccess,
  event: Pick<RepoQueryInvalidationEvent, 'repoId' | 'query'>,
  workspaceRuntimeId: string,
): Promise<void> {
  const repoId = event.repoId
  const repo = store.get().workspaces[repoId]
  if (!repo || repo.workspaceRuntimeId !== workspaceRuntimeId) return
  if (!gitWorkspaceCanExecute(repo)) return
  if (event.query === 'repo-runtime') {
    invalidateRepoRuntimeProjectionQueries(repoId, workspaceRuntimeId)
    return
  }
  invalidateRepoDataQueries(repoId, workspaceRuntimeId)
}
