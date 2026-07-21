import type { GitWorkspaceProjection } from '#/web/stores/workspaces/types.ts'

export function latestRepoSyncTime(repo: Pick<GitWorkspaceProjection, 'lastFetchAt'>): number | null {
  return repo.lastFetchAt
}
