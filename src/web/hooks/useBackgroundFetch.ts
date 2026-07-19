import { useEffect, useMemo } from 'react'
import { setBackgroundSyncRepos } from '#/web/repo-client.ts'
import { isWorkspaceUnavailable } from '#/web/stores/workspaces/workspace-guards.ts'
import type { WorkspaceState, WorkspacesStore } from '#/web/stores/workspaces/types.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { useFetchSettings } from '#/web/runtime-settings-fetch.ts'
import { hasClientServerConfig } from '#/web/lib/server-config.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { GitBackgroundSyncTarget } from '#/shared/git-background-sync.ts'
import { goblinLog } from '#/web/logger.ts'

function isBackgroundSyncEligible(repo: WorkspaceState | null | undefined): repo is WorkspaceState {
  return (
    !!repo &&
    !isWorkspaceUnavailable(repo) &&
    repo.capability.kind === 'git' &&
    repo.capability.git.remote.hasRemotes === true
  )
}

export function backgroundSyncTargetsFromStore(
  state: Pick<WorkspacesStore, 'workspaces'>,
  currentWorkspaceId: WorkspaceId | null,
): GitBackgroundSyncTarget[] {
  const currentWorkspace = currentWorkspaceId ? state.workspaces[currentWorkspaceId] : null
  return isBackgroundSyncEligible(currentWorkspace)
    ? [{ workspaceId: currentWorkspace.id, workspaceRuntimeId: currentWorkspace.workspaceRuntimeId }]
    : []
}

export function useBackgroundFetch({ currentWorkspaceId }: { currentWorkspaceId: WorkspaceId | null }) {
  const currentWorkspace = useWorkspacesStore((state) =>
    currentWorkspaceId ? state.workspaces[currentWorkspaceId] : undefined,
  )
  const eligible = isBackgroundSyncEligible(currentWorkspace)
  const eligibleWorkspaceId = eligible ? currentWorkspace.id : null
  const eligibleWorkspaceRuntimeId = eligible ? currentWorkspace.workspaceRuntimeId : null
  const eligibleTarget = useMemo(
    () =>
      eligibleWorkspaceId && eligibleWorkspaceRuntimeId
        ? { workspaceId: eligibleWorkspaceId, workspaceRuntimeId: eligibleWorkspaceRuntimeId }
        : null,
    [eligibleWorkspaceId, eligibleWorkspaceRuntimeId],
  )
  const { fetchIntervalSec } = useFetchSettings()
  const fetchEnabled = fetchIntervalSec > 0
  const hasServer = hasClientServerConfig()

  useEffect(() => {
    if (!hasServer) return
    const controller = new AbortController()
    const targets = fetchEnabled && eligibleTarget ? [eligibleTarget] : []
    void setBackgroundSyncRepos(targets, controller.signal).catch((err: unknown) => {
      if (!controller.signal.aborted) goblinLog.warn('background sync registration failed', { err })
    })
    return () => controller.abort('background-sync-target-changed')
  }, [eligibleTarget, fetchEnabled, hasServer])
}
