import { markRepoAvailable } from '#/web/stores/repos/availability.ts'
import { isRepoUnavailable } from '#/web/stores/repos/repo-guards.ts'
import {
  cancelDataLoad,
  finishDataLoadError,
  finishDataLoadSuccess,
} from '#/web/stores/repos/repo-data-load-state.ts'
import { canStartRemoteFetch } from '#/web/stores/repos/sync-state.ts'
import type { RepoSnapshot } from '#/shared/api-types.ts'
import type { RepoState, ReposGet } from '#/web/stores/repos/types.ts'
import type { ExecResult } from '#/web/types.ts'

export function applySnapshotToRepoProjection(
  r: RepoState,
  snap: RepoSnapshot,
  validBranches: Set<string>,
  previousSnapshotBranches: RepoSnapshot['branches'] | null,
): void {
  void previousSnapshotBranches
  void validBranches
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
  finishDataLoadSuccess(r.dataLoads.repoReadModel)
}

export function shouldAttemptFetch(repo: RepoState | null | undefined, repoRuntimeId: string): boolean {
  return !!repo && repo.repoRuntimeId === repoRuntimeId && repo.remote.hasRemotes === true && !isRepoUnavailable(repo)
}

export function repoIfFresh(get: ReposGet, id: string, repoRuntimeId: string): RepoState | null {
  const repo = get().repos[id]
  return repo && repo.repoRuntimeId === repoRuntimeId ? repo : null
}

export function resolveActionRepoRuntimeId(
  get: ReposGet,
  id: string,
  requestedRepoRuntimeId?: string,
): { repo: RepoState; repoRuntimeId: string } | null {
  const repo = get().repos[id]
  if (!repo) return null
  const repoRuntimeId = requestedRepoRuntimeId ?? repo.repoRuntimeId
  if (repo.repoRuntimeId !== repoRuntimeId) return null
  return { repo, repoRuntimeId }
}

export function applyFetchDataLoadResult(r: RepoState, result: ExecResult): void {
  if (result.ok) finishDataLoadSuccess(r.dataLoads.fetch)
  else if (result.message !== 'cancelled') finishDataLoadError(r.dataLoads.fetch, result.message)
  else cancelDataLoad(r.dataLoads.fetch)
}

export function applyFetchDataLoadError(r: RepoState, message: string): void {
  if (message === 'cancelled') cancelDataLoad(r.dataLoads.fetch)
  else finishDataLoadError(r.dataLoads.fetch, message)
}

export function canRunRemoteFetchNow(repo: RepoState): boolean {
  return canStartRemoteFetch(repo)
}
