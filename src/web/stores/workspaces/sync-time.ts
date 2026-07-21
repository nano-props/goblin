import type { RepoOperationsSnapshot } from '#/shared/api-types.ts'

export function latestRepoSyncTime(repo: Pick<RepoOperationsSnapshot, 'lastFetchAt'> | undefined): number | null {
  return repo?.lastFetchAt ?? null
}
