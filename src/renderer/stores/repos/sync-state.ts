import type { RepoState } from '#/renderer/stores/repos/types.ts'

export function canStartRemoteFetch(repo: RepoState | undefined): repo is RepoState {
  return (
    !!repo &&
    !repo.async.syncing &&
    !repo.async.fetching &&
    !repo.async.loading &&
    !repo.async.statusLoading &&
    !repo.async.refreshing
  )
}

export function isRemoteFetchDue(
  repo: RepoState | undefined,
  intervalMs: number,
  now: number = Date.now(),
): repo is RepoState {
  if (intervalMs <= 0 || !canStartRemoteFetch(repo)) return false
  return repo.async.lastFetchSettledAt === null || now - repo.async.lastFetchSettledAt >= intervalMs
}
