import { useEffect } from 'react'
import { setBackgroundSyncRepos } from '#/web/repo-client.ts'
import { isWorkspaceUnavailable } from '#/web/stores/workspaces/workspace-guards.ts'
import type { WorkspaceState, WorkspacesStore } from '#/web/stores/workspaces/types.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { useFetchSettings } from '#/web/runtime-settings-fetch.ts'
import { hasClientServerConfig } from '#/web/lib/server-config.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

function isBackgroundSyncEligible(repo: WorkspaceState | null | undefined): repo is WorkspaceState {
  return (
    !!repo &&
    !isWorkspaceUnavailable(repo) &&
    repo.capability.kind === 'git' &&
    repo.capability.git.remote.hasRemotes === true
  )
}

export function backgroundSyncRepoIdsFromStore(
  state: Pick<WorkspacesStore, 'workspaces'>,
  currentWorkspaceId: WorkspaceId | null,
): string[] {
  const currentWorkspace = currentWorkspaceId ? state.workspaces[currentWorkspaceId] : null
  return isBackgroundSyncEligible(currentWorkspace) ? [currentWorkspace.id] : []
}

export function useBackgroundFetch({ currentWorkspaceId }: { currentWorkspaceId: WorkspaceId | null }) {
  const eligibleRepoIdsKey = useWorkspacesStore((s) =>
    backgroundSyncRepoIdsFromStore(s, currentWorkspaceId).join('\0'),
  )
  const { fetchIntervalSec } = useFetchSettings()
  const hasServer = hasClientServerConfig()

  useEffect(() => {
    if (!hasServer) return
    const repoIds = fetchIntervalSec > 0 ? eligibleRepoIdsKey.split('\0').filter(Boolean) : []
    void setBackgroundSyncRepos(repoIds)
  }, [eligibleRepoIdsKey, fetchIntervalSec, hasServer])
}
