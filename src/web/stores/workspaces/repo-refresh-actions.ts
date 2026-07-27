import type { RepoQueryInvalidationEvent } from '#/shared/repo-query-invalidation.ts'
import {
  invalidateRepoOperationsQueries,
  invalidateRepoSnapshotQueries,
  invalidateRepoWorktreeSnapshotQueries,
} from '#/web/repo-query-runtime.ts'
import { gitWorkspaceCanExecute } from '#/web/stores/workspaces/workspace-guards.ts'
import type { RepoRefreshStoreAccess } from '#/web/stores/workspaces/refresh.ts'

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
    invalidateRepoOperationsQueries(repoId, workspaceRuntimeId)
    return
  }
  if (event.query === 'repo-worktree-snapshot') {
    invalidateRepoWorktreeSnapshotQueries(repoId, workspaceRuntimeId)
    return
  }
  invalidateRepoSnapshotQueries(repoId, workspaceRuntimeId)
}
