import { repoLocalRemoteFetchBlocked } from '#/web/stores/repos/repo-operation-scheduler.ts'
import { isRepoUnavailable } from '#/web/stores/repos/repo-guards.ts'
import type { RepoState } from '#/web/stores/repos/types.ts'

export function canStartRemoteFetch(repo: RepoState | undefined): repo is RepoState {
  if (!repo) return false
  if (isRepoUnavailable(repo)) return false
  // Network writes must not overlap with core repo reads/writes that mutate
  // runtime projection truth. Log and PR refreshes are metadata reads, so they
  // can remain visible without blocking manual sync/pull/push.
  return !repoLocalRemoteFetchBlocked(repo.id)
}
