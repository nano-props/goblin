import type { RepoReadInvalidationEvent } from '#/shared/repo-read-invalidation.ts'
import {
  invalidateRepoOperationsQueries,
  invalidateRepoMetadataQueries,
  invalidateRepoWorktreeStatusQueries,
} from '#/web/repo-query-runtime.ts'
import { gitWorkspaceCanExecute } from '#/web/stores/workspaces/workspace-guards.ts'
import type { RepoRefreshStoreAccess } from '#/web/stores/workspaces/refresh.ts'

export async function handleRepoInvalidationRefresh(
  store: RepoRefreshStoreAccess,
  event: Pick<RepoReadInvalidationEvent, 'repoId' | 'domain'>,
  workspaceRuntimeId: string,
): Promise<void> {
  const repoId = event.repoId
  const repo = store.get().workspaces[repoId]
  if (!repo || repo.workspaceRuntimeId !== workspaceRuntimeId) return
  if (!gitWorkspaceCanExecute(repo)) return
  if (event.domain === 'operations') {
    invalidateRepoOperationsQueries(repoId, workspaceRuntimeId)
    return
  }
  if (event.domain === 'worktree-status') {
    invalidateRepoWorktreeStatusQueries(repoId, workspaceRuntimeId)
    return
  }
  invalidateRepoMetadataQueries(repoId, workspaceRuntimeId)
}
