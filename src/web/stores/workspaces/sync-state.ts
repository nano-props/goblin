import { repoLocalRemoteFetchBlocked } from '#/web/stores/workspaces/repo-operation-scheduler.ts'
import { isRepoUnavailable } from '#/web/stores/workspaces/workspace-guards.ts'
import type { WorkspaceState } from '#/web/stores/workspaces/types.ts'

export function canStartRemoteFetch(repo: WorkspaceState | undefined): repo is WorkspaceState {
  if (!repo) return false
  if (isRepoUnavailable(repo)) return false
  // Network writes must not overlap with core repo reads/writes that mutate
  // runtime projection truth. Log and PR refreshes are metadata reads, so they
  // can remain visible without blocking manual sync/pull/push.
  return !repoLocalRemoteFetchBlocked(repo.id)
}
