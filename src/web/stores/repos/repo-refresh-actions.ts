import type { RepoQueryInvalidationEvent } from '#/shared/repo-query-invalidation.ts'
import { invalidateRepoDataQueries, invalidateRepoRuntimeProjectionQueries } from '#/web/repo-data-query.ts'
import { isRepoUnavailable } from '#/web/stores/repos/repo-guards.ts'
import type { RepoRefreshStoreAccess } from '#/web/stores/repos/refresh.ts'
import { refreshRepoWorktreeStatus } from '#/web/stores/repos/worktree-status-refresh.ts'
import { refreshWorkspaceRuntimes } from '#/web/workspace-runtime-query.ts'
import { acceptRemoteLifecycleSnapshot } from '#/web/stores/repos/remote-lifecycle-projection.ts'

export function requestVisibleWorkspaceStatusRefresh(
  store: RepoRefreshStoreAccess,
  id: string,
  workspaceRuntimeId: string,
  branchName: string | null,
): boolean {
  const repo = store.get().repos[id]
  if (!repo || repo.workspaceRuntimeId !== workspaceRuntimeId || !branchName) return false
  if (isRepoUnavailable(repo)) return false
  void refreshRepoWorktreeStatus(store, id, workspaceRuntimeId)
  return true
}

export async function handleRepoInvalidationRefresh(
  store: RepoRefreshStoreAccess,
  event: Pick<RepoQueryInvalidationEvent, 'repoId' | 'query'>,
  workspaceRuntimeId: string,
): Promise<void> {
  const repoId = event.repoId
  const repo = store.get().repos[repoId]
  if (!repo || repo.workspaceRuntimeId !== workspaceRuntimeId) return
  if (event.query === 'remote-lifecycle') {
    acceptRemoteLifecycleSnapshot(store.set, store.get, await refreshWorkspaceRuntimes())
    return
  }
  if (isRepoUnavailable(repo)) return
  if (event.query === 'repo-runtime') {
    invalidateRepoRuntimeProjectionQueries(repoId, workspaceRuntimeId)
    return
  }
  invalidateRepoDataQueries(repoId, workspaceRuntimeId)
}
