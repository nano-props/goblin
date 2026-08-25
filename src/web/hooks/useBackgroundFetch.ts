import { computed, onScopeDispose, toValue, watch } from 'vue'
import type { MaybeRefOrGetter } from 'vue'
import { workspaceCanExecute } from '#/web/stores/workspaces/workspace-guards.ts'
import type { RuntimeCoherentWorkspaceState, WorkspaceState } from '#/web/stores/workspaces/types.ts'
import { useFetchSettings } from '#/web/settings/runtime-fetch.ts'
import { getRepoSnapshotQueryData } from '#/web/repos/query-cache.ts'
import { useRepoSnapshotReadModel } from '#/web/repos/queries.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { GitBackgroundSyncTarget } from '#/shared/git-background-sync.ts'
import { createBackgroundSyncRegistrationOwner } from '#/web/repos/background-sync-registration.ts'

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
  const registration = createBackgroundSyncRegistrationOwner()
  const snapshotReadModel = useRepoSnapshotReadModel(
    () => toValue(workspaceId),
    () => toValue(workspaceRuntimeId),
  )
  const hasRemotes = computed(() => snapshotReadModel.data.value?.snapshot.remote.hasRemotes === true)
  const fetchSettings = useFetchSettings()
  const fetchEnabled = computed(() => fetchSettings.value.fetchIntervalSec > 0)

  // This watch owns the authoritative declaration. A transport reset aborts
  // every delivered command, so this declarative projection rehydrates from
  // the complete current target instead of replaying an opaque mutation.
  watch(
    [() => toValue(workspaceId), () => toValue(workspaceRuntimeId), hasRemotes, fetchEnabled],
    ([currentWorkspaceId, currentWorkspaceRuntimeId, remoteAvailable, enabled]) => {
      const targets: GitBackgroundSyncTarget[] =
        enabled && remoteAvailable
          ? [{ workspaceId: currentWorkspaceId, workspaceRuntimeId: currentWorkspaceRuntimeId }]
          : []
      registration.setTargets(targets)
    },
    { immediate: true },
  )

  onScopeDispose(registration.dispose)
}
