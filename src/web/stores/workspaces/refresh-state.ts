import { markRepoAvailable } from '#/web/stores/workspaces/availability.ts'
import { isRepoUnavailable } from '#/web/stores/workspaces/workspace-guards.ts'
import {
  cancelDataLoad,
  finishDataLoadError,
  finishDataLoadSuccess,
} from '#/web/stores/workspaces/repo-data-load-state.ts'
import { canStartRemoteFetch } from '#/web/stores/workspaces/sync-state.ts'
import type { RepoSnapshot } from '#/shared/api-types.ts'
import type { WorkspaceState, WorkspacesGet } from '#/web/stores/workspaces/types.ts'
import type { ExecResult } from '#/web/types.ts'
import {
  gitWorkspaceProjection,
  isGitWorkspace,
  type GitWorkspaceState,
} from '#/web/stores/workspaces/git-workspace-projection.ts'

export function applyRepoSnapshotShellState(r: WorkspaceState, snap: RepoSnapshot, loadedAt = Date.now()): void {
  if (!isGitWorkspace(r)) return
  const git = gitWorkspaceProjection(r)
  if (snap.remote) {
    git.remote.remotes = snap.remote.remotes.map((remote) => remote.name)
    git.remote.remoteDetails = snap.remote.remotes
    git.remote.hasRemotes = snap.remote.hasRemotes
    git.remote.hasBrowserRemote = snap.remote.hasBrowserRemote
    git.remote.browserRemoteProvider = snap.remote.browserRemoteProvider
    git.remote.remoteProviders = snap.remote.remoteProviders
    git.remote.hasGitHubRemote = snap.remote.hasGitHubRemote
    if (!snap.remote.hasRemotes) {
      git.remote.fetchFailed = false
      git.remote.fetchError = null
    }
  }
  markRepoAvailable(r)
  git.projection.source = 'fresh'
  git.projection.savedAt = null
  finishDataLoadSuccess(git.dataLoads.repoReadModel, loadedAt)
}

export function shouldAttemptFetch(repo: WorkspaceState | null | undefined, workspaceRuntimeId: string): boolean {
  return (
    !!repo &&
    repo.workspaceRuntimeId === workspaceRuntimeId &&
    isGitWorkspace(repo) &&
    gitWorkspaceProjection(repo).remote.hasRemotes === true &&
    !isRepoUnavailable(repo)
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

export function applyFetchDataLoadResult(r: WorkspaceState, result: ExecResult): void {
  if (!isGitWorkspace(r)) return
  const fetch = gitWorkspaceProjection(r).dataLoads.fetch
  if (result.ok) finishDataLoadSuccess(fetch)
  else if (result.message !== 'cancelled') finishDataLoadError(fetch, result.message)
  else cancelDataLoad(fetch)
}

export function applyFetchDataLoadError(r: WorkspaceState, message: string): void {
  if (!isGitWorkspace(r)) return
  const fetch = gitWorkspaceProjection(r).dataLoads.fetch
  if (message === 'cancelled') cancelDataLoad(fetch)
  else finishDataLoadError(fetch, message)
}

export function canRunRemoteFetchNow(repo: WorkspaceState): boolean {
  return isGitWorkspace(repo) && canStartRemoteFetch(repo)
}
