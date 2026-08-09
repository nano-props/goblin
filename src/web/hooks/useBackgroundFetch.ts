import { computed, onScopeDispose, toValue, watch } from 'vue'
import type { MaybeRefOrGetter } from 'vue'
import { setBackgroundSyncRepos } from '#/web/repo-client.ts'
import { workspaceCanExecute } from '#/web/stores/workspaces/workspace-guards.ts'
import type { RuntimeCoherentWorkspaceState, WorkspaceState } from '#/web/stores/workspaces/types.ts'
import { useFetchSettings } from '#/web/runtime-settings-fetch.ts'
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

export function useBackgroundFetch({
  workspaceId,
  workspaceRuntimeId,
}: {
  workspaceId: MaybeRefOrGetter<WorkspaceId>
  workspaceRuntimeId: MaybeRefOrGetter<string>
}) {
  let hasDeclaredGitTarget = false
  const snapshotReadModel = useRepoSnapshotReadModel(
    () => toValue(workspaceId),
    () => toValue(workspaceRuntimeId),
  )
  const hasRemotes = computed(() => snapshotReadModel.data.value?.snapshot.remote.hasRemotes === true)
  const fetchSettings = useFetchSettings()
  const fetchEnabled = computed(() => fetchSettings.value.fetchIntervalSec > 0)

  // This watch owns the server registration and aborts the superseded request
  // whenever the authoritative target or fetch policy changes.
  watch(
    [() => toValue(workspaceId), () => toValue(workspaceRuntimeId), hasRemotes, fetchEnabled],
    ([currentWorkspaceId, currentWorkspaceRuntimeId, remoteAvailable, enabled], _previous, onCleanup) => {
      const targets: GitBackgroundSyncTarget[] =
        enabled && remoteAvailable
          ? [{ workspaceId: currentWorkspaceId, workspaceRuntimeId: currentWorkspaceRuntimeId }]
          : []
      if (targets.length === 0 && !hasDeclaredGitTarget) return
      const controller = new AbortController()
      onCleanup(() => controller.abort('background-sync-target-changed'))
      if (targets.length > 0) hasDeclaredGitTarget = true
      void setBackgroundSyncRepos(targets, controller.signal)
        .then(() => {
          if (targets.length === 0) hasDeclaredGitTarget = false
        })
        .catch((err: unknown) => {
          if (!controller.signal.aborted) goblinLog.warn('background sync registration failed', { err })
        })
    },
    { immediate: true },
  )

  onScopeDispose(() => {
    if (!hasDeclaredGitTarget) return
    hasDeclaredGitTarget = false
    void setBackgroundSyncRepos([]).catch((err: unknown) => {
      goblinLog.warn('background sync registration cleanup failed', { err })
    })
  })
}
