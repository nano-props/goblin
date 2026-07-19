import { repoLocalRemoteFetchBlocked } from '#/web/stores/workspaces/repo-operation-scheduler.ts'
import { workspaceCanExecute } from '#/web/stores/workspaces/workspace-guards.ts'
import type { WorkspaceState } from '#/web/stores/workspaces/types.ts'
import { isGitWorkspace, type GitWorkspaceState } from '#/web/stores/workspaces/git-workspace-projection.ts'

export function canStartRemoteFetch(repo: WorkspaceState | undefined): repo is GitWorkspaceState {
  if (!repo || !isGitWorkspace(repo)) return false
  if (!workspaceCanExecute(repo)) return false
  // Network writes must not overlap with core repo reads/writes that mutate
  // runtime projection truth. Log and PR refreshes are metadata reads, so they
  // can remain visible without blocking manual sync/pull/push.
  return !repoLocalRemoteFetchBlocked(repo.id)
}
