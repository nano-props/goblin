import { computed, onScopeDispose, toValue, watch } from 'vue'
import type { MaybeRefOrGetter } from 'vue'
import { setBackgroundSyncRepos } from '#/web/repos/client.ts'
import { workspaceCanExecute } from '#/web/stores/workspaces/workspace-guards.ts'
import type { RuntimeCoherentWorkspaceState, WorkspaceState } from '#/web/stores/workspaces/types.ts'
import { useFetchSettings } from '#/web/settings/runtime-fetch.ts'
import { getRepoSnapshotQueryData } from '#/web/repos/query-cache.ts'
import { useRepoSnapshotReadModel } from '#/web/repos/queries.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { GitBackgroundSyncTarget } from '#/shared/git-background-sync.ts'
import { goblinLog } from '#/web/logger.ts'
import { subscribeServerCommandTransportReset } from '#/web/lib/server-command-transport.ts'

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
  let currentTargets: GitBackgroundSyncTarget[] = []
  let registrationController: AbortController | null = null
  const snapshotReadModel = useRepoSnapshotReadModel(
    () => toValue(workspaceId),
    () => toValue(workspaceRuntimeId),
  )
  const hasRemotes = computed(() => snapshotReadModel.data.value?.snapshot.remote.hasRemotes === true)
  const fetchSettings = useFetchSettings()
  const fetchEnabled = computed(() => fetchSettings.value.fetchIntervalSec > 0)

  const declareCurrentTargets = () => {
    registrationController?.abort('background-sync-registration-superseded')
    const controller = new AbortController()
    registrationController = controller
    const targets = currentTargets
    if (targets.length > 0) hasDeclaredGitTarget = true
    void setBackgroundSyncRepos(targets, controller.signal)
      .then(() => {
        if (registrationController !== controller) return
        if (targets.length === 0) hasDeclaredGitTarget = false
      })
      .catch((err: unknown) => {
        if (registrationController !== controller) return
        if (!controller.signal.aborted) goblinLog.warn('background sync registration failed', { err })
      })
  }

  // This watch owns the authoritative declaration. A transport reset aborts
  // every delivered command, so this declarative projection rehydrates from
  // the complete current target instead of replaying an opaque mutation.
  watch(
    [() => toValue(workspaceId), () => toValue(workspaceRuntimeId), hasRemotes, fetchEnabled],
    ([currentWorkspaceId, currentWorkspaceRuntimeId, remoteAvailable, enabled]) => {
      currentTargets =
        enabled && remoteAvailable
          ? [{ workspaceId: currentWorkspaceId, workspaceRuntimeId: currentWorkspaceRuntimeId }]
          : []
      if (currentTargets.length === 0 && !hasDeclaredGitTarget) return
      declareCurrentTargets()
    },
    { immediate: true },
  )

  const unsubscribeTransportReset = subscribeServerCommandTransportReset(() => {
    if (currentTargets.length === 0 && !hasDeclaredGitTarget) return
    declareCurrentTargets()
  })

  onScopeDispose(() => {
    unsubscribeTransportReset()
    registrationController?.abort('background-sync-owner-disposed')
    registrationController = null
    if (!hasDeclaredGitTarget) return
    hasDeclaredGitTarget = false
    void setBackgroundSyncRepos([]).catch((err: unknown) => {
      goblinLog.warn('background sync registration cleanup failed', { err })
    })
  })
}
