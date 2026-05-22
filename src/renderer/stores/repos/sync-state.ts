import type { RepoState } from '#/renderer/stores/repos/types.ts'

export function canStartRemoteFetch(repo: RepoState | undefined): repo is RepoState {
  return !!repo && !repo.syncing && !repo.fetching && !repo.loading && !repo.statusLoading
}

export function isRemoteFetchDue(
  repo: RepoState | undefined,
  intervalMs: number,
  now: number = Date.now(),
): repo is RepoState {
  if (intervalMs <= 0 || !canStartRemoteFetch(repo)) return false
  return repo.lastFetchSettledAt === null || now - repo.lastFetchSettledAt >= intervalMs
}
