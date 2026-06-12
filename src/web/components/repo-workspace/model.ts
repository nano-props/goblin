import { resourceInitialLoading } from '#/web/stores/repos/resources.ts'
import type { RepoState } from '#/web/stores/repos/types.ts'
export interface RepoWorkspacePresentation {
  exists: boolean
  initialLoading: boolean
}

export function getRepoWorkspacePresentation(repo: RepoState | undefined): RepoWorkspacePresentation {
  if (!repo) return { exists: false, initialLoading: false }
  // Snapshot is loading when either it never resolved or the SSH probe
  // hasn't settled yet for a remote repo with no cached data. The
  // latter is the slow-network case: the placeholder tab is up but we
  // don't yet know whether the remote is reachable, so we keep showing
  // the skeleton instead of the empty state. Once cached data is
  // available the projection already shows stale branches and we drop
  // the skeleton.
  const remoteConnecting = repo.remote.connectivity === 'connecting'
  const hasLoadedSnapshot = repo.resources.snapshot.loadedAt !== null
  return {
    exists: true,
    initialLoading:
      resourceInitialLoading(repo.resources.snapshot) || (remoteConnecting && !hasLoadedSnapshot),
  }
}
