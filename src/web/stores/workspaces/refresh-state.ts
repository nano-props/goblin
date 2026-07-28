import { workspaceCanExecute } from '#/web/stores/workspaces/workspace-guards.ts'
import { canStartRemoteFetch } from '#/web/stores/workspaces/sync-state.ts'
import type { WorkspaceState, WorkspacesGet } from '#/web/stores/workspaces/types.ts'
import { getRepoSnapshotQueryData } from '#/web/repo-query-cache.ts'
import { isGitWorkspace, type GitWorkspaceState } from '#/web/stores/workspaces/git-workspace-client-state.ts'

export function shouldAttemptFetch(repo: WorkspaceState | null | undefined, workspaceRuntimeId: string): boolean {
  return (
    !!repo &&
    repo.workspaceRuntimeId === workspaceRuntimeId &&
    isGitWorkspace(repo) &&
    getRepoSnapshotQueryData(repo.id, workspaceRuntimeId)?.remote.hasRemotes === true &&
    workspaceCanExecute(repo)
  )
}

export function repoIfFresh(get: WorkspacesGet, id: string, workspaceRuntimeId: string): WorkspaceState | null {
  const repo = get().workspaces[id]
  return repo && repo.workspaceRuntimeId === workspaceRuntimeId ? repo : null
}

export function resolveActionWorkspaceRuntimeId(
  get: WorkspacesGet,
  id: string,
  requestedWorkspaceRuntimeId?: string,
): { repo: GitWorkspaceState; workspaceRuntimeId: string } | null {
  const repo = get().workspaces[id]
  if (!repo || !isGitWorkspace(repo)) return null
  const workspaceRuntimeId = requestedWorkspaceRuntimeId ?? repo.workspaceRuntimeId
  if (repo.workspaceRuntimeId !== workspaceRuntimeId) return null
  return { repo, workspaceRuntimeId }
}

export function canRunRemoteFetchNow(repo: WorkspaceState): boolean {
  return isGitWorkspace(repo) && canStartRemoteFetch(repo)
}
