import type { RepoQueryInvalidationEvent } from '#/shared/repo-query-invalidation.ts'
import { invalidateRepoDataQueries, invalidateRepoRuntimeProjectionQueries } from '#/web/repo-data-query.ts'
import { isRepoUnavailable } from '#/web/stores/repos/repo-guards.ts'
import type { RepoRefreshStoreAccess } from '#/web/stores/repos/refresh.ts'
import { refreshRepoRuntimes } from '#/web/repo-runtime-query.ts'
import { acceptRemoteLifecycleSnapshot } from '#/web/stores/repos/remote-lifecycle-projection.ts'

export async function handleRepoInvalidationRefresh(
  store: RepoRefreshStoreAccess,
  event: Pick<RepoQueryInvalidationEvent, 'repoId' | 'query'>,
  repoRuntimeId: string,
): Promise<void> {
  const repoId = event.repoId
  const repo = store.get().repos[repoId]
  if (!repo || repo.repoRuntimeId !== repoRuntimeId) return
  if (event.query === 'remote-lifecycle') {
    acceptRemoteLifecycleSnapshot(store.set, store.get, await refreshRepoRuntimes())
    return
  }
  if (isRepoUnavailable(repo)) return
  if (event.query === 'repo-runtime') {
    invalidateRepoRuntimeProjectionQueries(repoId, repoRuntimeId)
    return
  }
  invalidateRepoDataQueries(repoId, repoRuntimeId)
}
