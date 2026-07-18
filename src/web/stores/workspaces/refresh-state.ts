import { markRepoAvailable } from '#/web/stores/workspaces/availability.ts'
import { isRepoUnavailable } from '#/web/stores/workspaces/workspace-guards.ts'
import { cancelDataLoad, finishDataLoadError, finishDataLoadSuccess } from '#/web/stores/workspaces/repo-data-load-state.ts'
import { canStartRemoteFetch } from '#/web/stores/workspaces/sync-state.ts'
import type { RepoSnapshot } from '#/shared/api-types.ts'
import type { WorkspaceState, WorkspacesGet } from '#/web/stores/workspaces/types.ts'
import type { ExecResult } from '#/web/types.ts'

export function applyRepoSnapshotShellState(r: WorkspaceState, snap: RepoSnapshot, loadedAt = Date.now()): void {
  if (snap.remote) {
    r.remote.remotes = snap.remote.remotes.map((remote) => remote.name)
    r.remote.remoteDetails = snap.remote.remotes
    r.remote.hasRemotes = snap.remote.hasRemotes
    r.remote.hasBrowserRemote = snap.remote.hasBrowserRemote
    r.remote.browserRemoteProvider = snap.remote.browserRemoteProvider
    r.remote.remoteProviders = snap.remote.remoteProviders
    r.remote.hasGitHubRemote = snap.remote.hasGitHubRemote
    if (!snap.remote.hasRemotes) {
      r.remote.fetchFailed = false
      r.remote.fetchError = null
    }
  }
  markRepoAvailable(r)
  r.projection.source = 'fresh'
  r.projection.savedAt = null
  finishDataLoadSuccess(r.dataLoads.repoReadModel, loadedAt)
}

export function shouldAttemptFetch(repo: WorkspaceState | null | undefined, workspaceRuntimeId: string): boolean {
  return !!repo && repo.workspaceRuntimeId === workspaceRuntimeId && repo.remote.hasRemotes === true && !isRepoUnavailable(repo)
}

export function repoIfFresh(get: WorkspacesGet, id: string, workspaceRuntimeId: string): WorkspaceState | null {
  const repo = get().workspaces[id]
  return repo && repo.workspaceRuntimeId === workspaceRuntimeId ? repo : null
}

export function resolveActionWorkspaceRuntimeId(
  get: WorkspacesGet,
  id: string,
  requestedWorkspaceRuntimeId?: string,
): { repo: WorkspaceState; workspaceRuntimeId: string } | null {
  const repo = get().workspaces[id]
  if (!repo) return null
  const workspaceRuntimeId = requestedWorkspaceRuntimeId ?? repo.workspaceRuntimeId
  if (repo.workspaceRuntimeId !== workspaceRuntimeId) return null
  return { repo, workspaceRuntimeId }
}

export function applyFetchDataLoadResult(r: WorkspaceState, result: ExecResult): void {
  if (result.ok) finishDataLoadSuccess(r.dataLoads.fetch)
  else if (result.message !== 'cancelled') finishDataLoadError(r.dataLoads.fetch, result.message)
  else cancelDataLoad(r.dataLoads.fetch)
}

export function applyFetchDataLoadError(r: WorkspaceState, message: string): void {
  if (message === 'cancelled') cancelDataLoad(r.dataLoads.fetch)
  else finishDataLoadError(r.dataLoads.fetch, message)
}

export function canRunRemoteFetchNow(repo: WorkspaceState): boolean {
  return canStartRemoteFetch(repo)
}
