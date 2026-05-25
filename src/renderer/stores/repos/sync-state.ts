import { repoOperation, repoOperationBusy } from '#/renderer/stores/repos/runtime.ts'
import { resourceBusy } from '#/renderer/stores/repos/resources.ts'
import type { RepoState } from '#/renderer/stores/repos/types.ts'

export function canStartRemoteFetch(repo: RepoState | undefined): repo is RepoState {
  if (!repo) return false
  // Network writes must not overlap with core repo reads/writes that mutate
  // branch/status truth. Log and PR refreshes are metadata reads, so they can
  // remain visible without blocking manual sync/pull/push.
  return (
    !resourceBusy(repo.resources.fetch) &&
    !resourceBusy(repo.resources.branchAction) &&
    !resourceBusy(repo.resources.snapshot) &&
    !resourceBusy(repo.resources.status) &&
    !repoOperationBusy(repo.id, 'fetch') &&
    !repoOperationBusy(repo.id, 'branchAction') &&
    !repoOperationBusy(repo.id, 'snapshot') &&
    !repoOperationBusy(repo.id, 'status')
  )
}

export function isRemoteFetchDue(
  repo: RepoState | undefined,
  intervalMs: number,
  now: number = Date.now(),
): repo is RepoState {
  if (intervalMs <= 0 || !canStartRemoteFetch(repo)) return false
  const lastFetchAt = repo.resources.fetch.loadedAt ?? repoOperation(repo.id, 'fetch').settledAt
  return lastFetchAt === null || now - lastFetchAt >= intervalMs
}
