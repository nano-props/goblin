import type { WorkspacePaneTabType } from '#/shared/workspace-pane.ts'
import type { RepoQueryInvalidationEvent } from '#/shared/repo-query-invalidation.ts'
import { invalidateRepoDataQueries, invalidateRepoRuntimeProjectionQueries } from '#/web/repo-data-query.ts'
import { isRepoUnavailable } from '#/web/stores/repos/repo-guards.ts'
import { requestRepoRuntimeProjectionRefresh, type RepoRefreshStoreAccess } from '#/web/stores/repos/refresh.ts'
import type { RepoState } from '#/web/stores/repos/types.ts'

export interface RepoVisibleProjectionRefreshState {
  id: string
  repoRuntimeId: string
  preferredWorkspacePaneTab: WorkspacePaneTabType | null
  renderedWorkspacePaneTab: WorkspacePaneTabType | null
  branchName: string | null
  visibleProjectionViewOpen: boolean
  unavailable: boolean
  visibleStatusPhase: 'idle' | 'loading' | 'refreshing'
}

export function isRepoVisibleProjectionRefreshable(repo: RepoVisibleProjectionRefreshState): boolean {
  return !repo.unavailable && repo.visibleStatusPhase === 'idle'
}

function isRepoStateVisibleProjectionRefreshable(repo: RepoState): boolean {
  return !isRepoUnavailable(repo) && repo.dataLoads.visibleStatus.phase === 'idle'
}

export async function requestVisibleRepoRuntimeProjectionRefresh(
  store: RepoRefreshStoreAccess,
  id: string,
  repoRuntimeId: string,
  branchName: string | null,
): Promise<void> {
  const repo = store.get().repos[id]
  if (!repo || repo.repoRuntimeId !== repoRuntimeId) return
  if (!isRepoStateVisibleProjectionRefreshable(repo)) return
  await requestRepoRuntimeProjectionRefresh(store, id, { repoRuntimeId, scope: 'visible-status', branchName })
}

export function requestVisibleRepoProjectionRefresh(
  store: RepoRefreshStoreAccess,
  id: string,
  branchName: string | null,
): void {
  const repo = store.get().repos[id]
  if (!repo) return
  void requestVisibleRepoRuntimeProjectionRefresh(store, id, repo.repoRuntimeId, branchName)
}

export async function handleRepoInvalidationRefresh(
  store: RepoRefreshStoreAccess,
  event: Pick<RepoQueryInvalidationEvent, 'repoId' | 'query'>,
  repoRuntimeId: string,
): Promise<void> {
  const repoId = event.repoId
  const repo = store.get().repos[repoId]
  if (!repo || repo.repoRuntimeId !== repoRuntimeId || isRepoUnavailable(repo)) return
  if (event.query === 'repo-runtime') {
    invalidateRepoRuntimeProjectionQueries(repoId, repoRuntimeId)
    return
  }
  invalidateRepoDataQueries(repoId, repoRuntimeId)
}
