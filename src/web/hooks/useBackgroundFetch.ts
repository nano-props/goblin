import { useEffect } from 'react'
import { setBackgroundSyncRepos } from '#/web/repo-client.ts'
import { isRepoUnavailable } from '#/web/stores/repos/repo-guards.ts'
import type { RepoState, ReposStore } from '#/web/stores/repos/types.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { useFetchSettings } from '#/web/runtime-settings-fetch.ts'
import { hasClientServerConfig } from '#/web/lib/server-config.ts'

function isBackgroundSyncEligible(repo: RepoState | null | undefined): repo is RepoState {
  return !!repo && !isRepoUnavailable(repo) && repo.remote.hasRemotes === true
}

export function backgroundSyncRepoIdsFromStore(
  state: Pick<ReposStore, 'repos'>,
  hydratedRouteRepoId: string | null,
): string[] {
  const currentRepo = hydratedRouteRepoId ? state.repos[hydratedRouteRepoId] : null
  return isBackgroundSyncEligible(currentRepo) ? [currentRepo.id] : []
}

export function useBackgroundFetch({ hydratedRouteRepoId }: { hydratedRouteRepoId: string | null }) {
  const eligibleRepoIdsKey = useReposStore((s) => backgroundSyncRepoIdsFromStore(s, hydratedRouteRepoId).join('\0'))
  const { fetchIntervalSec } = useFetchSettings()
  const hasServer = hasClientServerConfig()

  useEffect(() => {
    if (!hasServer) return
    const repoIds = fetchIntervalSec > 0 ? eligibleRepoIdsKey.split('\0').filter(Boolean) : []
    void setBackgroundSyncRepos(repoIds)
  }, [eligibleRepoIdsKey, fetchIntervalSec, hasServer])
}
