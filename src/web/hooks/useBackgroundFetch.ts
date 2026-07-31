import { useEffect, useMemo, useRef } from 'react'
import { setBackgroundSyncRepos } from '#/web/repo-client.ts'
import { workspaceCanExecute } from '#/web/stores/workspaces/workspace-guards.ts'
import type { RuntimeCoherentWorkspaceState, WorkspaceState } from '#/web/stores/workspaces/types.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { useFetchSettings } from '#/web/runtime-settings-fetch.ts'
import { hasClientServerConfig } from '#/web/lib/server-config.ts'
import { getRepoSnapshotQueryData } from '#/web/repo-query-cache.ts'
import { useRepoSnapshotReadModel } from '#/web/repo-queries.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { GitBackgroundSyncTarget } from '#/shared/git-background-sync.ts'
import { goblinLog } from '#/web/logger.ts'

function isExecutableGitWorkspace(repo: WorkspaceState | null | undefined): repo is WorkspaceState {
  return !!repo && workspaceCanExecute(repo) && repo.capability.kind === 'git'
}

export function backgroundSyncTargetsFromStore(
  state: RuntimeCoherentWorkspaceState,
  currentWorkspaceId: WorkspaceId | null,
): GitBackgroundSyncTarget[] {
  const currentWorkspace = currentWorkspaceId ? state.workspaces[currentWorkspaceId] : null
  const snapshot = currentWorkspace
    ? getRepoSnapshotQueryData(currentWorkspace.id, currentWorkspace.workspaceRuntimeId)
    : undefined
  return isExecutableGitWorkspace(currentWorkspace) && snapshot?.remote.hasRemotes === true
    ? [{ workspaceId: currentWorkspace.id, workspaceRuntimeId: currentWorkspace.workspaceRuntimeId }]
    : []
}

export function useBackgroundFetch({ currentWorkspaceId }: { currentWorkspaceId: WorkspaceId | null }) {
  const hasDeclaredGitTarget = useRef(false)
  const currentWorkspace = useWorkspacesStore((state) =>
    currentWorkspaceId ? state.workspaces[currentWorkspaceId] : undefined,
  )
  const executableGitWorkspace = isExecutableGitWorkspace(currentWorkspace)
  const snapshotReadModel = useRepoSnapshotReadModel(
    executableGitWorkspace ? currentWorkspace.id : null,
    executableGitWorkspace ? currentWorkspace.workspaceRuntimeId : '',
    executableGitWorkspace,
  )
  const eligible = executableGitWorkspace && snapshotReadModel.data?.snapshot.remote.hasRemotes === true
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
    const targets = fetchEnabled && eligibleTarget ? [eligibleTarget] : []
    if (targets.length === 0 && !hasDeclaredGitTarget.current) return
    const controller = new AbortController()
    if (targets.length > 0) hasDeclaredGitTarget.current = true
    void setBackgroundSyncRepos(targets, controller.signal)
      .then(() => {
        if (targets.length === 0) hasDeclaredGitTarget.current = false
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) goblinLog.warn('background sync registration failed', { err })
      })
    return () => controller.abort('background-sync-target-changed')
  }, [eligibleTarget, fetchEnabled, hasServer])
}
