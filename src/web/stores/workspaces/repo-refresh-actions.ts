import type { RepoReadInvalidationEvent } from '#/shared/repo-read-invalidation.ts'
import {
  invalidateRepoOperationsQueries,
  invalidateRepoMetadataQueries,
  invalidateRepoWorktreeStatusQueries,
  refreshActiveRepoPullRequestQueries,
} from '#/web/repo-query-runtime.ts'
import { gitWorkspaceCanExecute } from '#/web/stores/workspaces/workspace-guards.ts'
import type { RepoRefreshStoreAccess } from '#/web/stores/workspaces/refresh.ts'

export async function handleRepoInvalidationRefresh(
  store: Pick<RepoRefreshStoreAccess, 'get'>,
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

export async function resyncActiveRepoReadQueries(store: Pick<RepoRefreshStoreAccess, 'get'>): Promise<void> {
  const pullRequestRefreshes: Promise<void>[] = []
  for (const repo of Object.values(store.get().workspaces)) {
    if (!gitWorkspaceCanExecute(repo)) continue
    const workspaceRuntimeId = repo.workspaceRuntimeId
    invalidateRepoMetadataQueries(repo.id, workspaceRuntimeId)
    invalidateRepoWorktreeStatusQueries(repo.id, workspaceRuntimeId)
    invalidateRepoOperationsQueries(repo.id, workspaceRuntimeId)
    pullRequestRefreshes.push(refreshActiveRepoPullRequestQueries(repo.id, workspaceRuntimeId))
  }
  await Promise.all(pullRequestRefreshes)
}
