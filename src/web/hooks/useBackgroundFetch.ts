import { useEffect } from 'react'
import { setBackgroundSyncRepos } from '#/web/repo-client.ts'
import { isRepoUnavailable } from '#/web/stores/workspaces/workspace-guards.ts'
import type { WorkspaceState, WorkspacesStore } from '#/web/stores/workspaces/types.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { useFetchSettings } from '#/web/runtime-settings-fetch.ts'
import { hasClientServerConfig } from '#/web/lib/server-config.ts'

function isBackgroundSyncEligible(repo: WorkspaceState | null | undefined): repo is WorkspaceState {
  return !!repo && !isRepoUnavailable(repo) && repo.remote.hasRemotes === true
}

export function backgroundSyncRepoIdsFromStore(
  state: Pick<WorkspacesStore, 'workspaces'>,
  hydratedRouteRepoId: string | null,
): string[] {
  const currentRepo = hydratedRouteRepoId ? state.workspaces[hydratedRouteRepoId] : null
  return isBackgroundSyncEligible(currentRepo) ? [currentRepo.id] : []
}

export function useBackgroundFetch({ hydratedRouteRepoId }: { hydratedRouteRepoId: string | null }) {
  const eligibleRepoIdsKey = useWorkspacesStore((s) => backgroundSyncRepoIdsFromStore(s, hydratedRouteRepoId).join('\0'))
  const { fetchIntervalSec } = useFetchSettings()
  const hasServer = hasClientServerConfig()

  useEffect(() => {
    if (!hasServer) return
    const repoIds = fetchIntervalSec > 0 ? eligibleRepoIdsKey.split('\0').filter(Boolean) : []
    void setBackgroundSyncRepos(repoIds)
  }, [eligibleRepoIdsKey, fetchIntervalSec, hasServer])
}
