import { onScopeDispose, shallowRef, toValue, watch } from 'vue'
import type { MaybeRefOrGetter } from 'vue'
import { shallow } from 'zustand/vanilla/shallow'
import type { ClientWorkspaceState } from '#/shared/api-types.ts'
import { writeClientWorkspaceState } from '#/web/client-workspace-state.ts'
import { subscribeAppQuitting } from '#/web/app-lifecycle.ts'
import { sessionLog } from '#/web/logger.ts'
import { clientWorkspaceStateFromRestorableWorkspaceState } from '#/web/restorable-workspace-state.ts'
import { filetreeInteractionStore } from '#/web/stores/workspaces/filetree-interaction-state.ts'
import {
  restorableWorkspaceStateFromStore,
  workspaceSessionPersistenceOpenFromStore,
} from '#/web/stores/workspaces/selector-state.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import {
  subscribeWorkspacePaneTabsPersistenceChanges,
  workspacePaneTabsPersistenceSnapshot,
} from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { useStoreSelector } from '#/web/stores/store-selector.ts'

const CLIENT_WORKSPACE_SAVE_DEBOUNCE_MS = 200

interface ClientWorkspacePersistenceInput {
  workspaceMembershipReady: boolean
  sessionPersistenceReady: boolean
  sessionRestoreError: string | null
  restoredClientWorkspaceBaseline: ReturnType<typeof workspacesStore.getState>['restoredClientWorkspaceBaseline']
  workspaces: ReturnType<typeof workspacesStore.getState>['workspaces']
  workspaceOrder: WorkspaceId[]
  restoredWorkspaceId: WorkspaceId | null
  zenMode: boolean
  workspacePaneSize: number
  selectedTerminalSessionIdByTerminalFilesystemTarget: Record<string, string>
  branchViewModeByWorkspace: ReturnType<typeof workspacesStore.getState>['branchViewModeByWorkspace']
  filetreeInteractionByScope: Parameters<
    typeof clientWorkspaceStateFromRestorableWorkspaceState
  >[0]['filetreeInteractionByScope']
}

export function useClientWorkspacePersistence({
  routedWorkspaceId,
}: {
  routedWorkspaceId: MaybeRefOrGetter<WorkspaceId | null>
}) {
  const persistenceInput = useStoreSelector(
    workspacesStore,
    (state): Omit<ClientWorkspacePersistenceInput, 'filetreeInteractionByScope'> => ({
      restoredWorkspaceId: state.restoredWorkspaceId,
      workspaceOrder: state.workspaceOrder,
      zenMode: state.zenMode,
      workspacePaneSize: state.workspacePaneSize,
      selectedTerminalSessionIdByTerminalFilesystemTarget: state.selectedTerminalSessionIdByTerminalFilesystemTarget,
      branchViewModeByWorkspace: state.branchViewModeByWorkspace,
      workspaceMembershipReady: state.workspaceMembershipReady,
      sessionPersistenceReady: state.sessionPersistenceReady,
      sessionRestoreError: state.sessionRestoreError,
      restoredClientWorkspaceBaseline: state.restoredClientWorkspaceBaseline,
      workspaces: state.workspaces,
    }),
    shallow,
  )
  const workspacePaneTabsVersion = useWorkspacePaneTabsCacheVersion()
  const filetreeInteractionByScope = useStoreSelector(filetreeInteractionStore, (state) => state.interactionByScope)
  let lastImmediateKey: string | null = null
  let lastRoutedWorkspaceId: WorkspaceId | null = null
  let debounceTimer: number | null = null

  const latestClientWorkspace = () =>
    clientWorkspaceFromPersistenceInput(
      {
        ...persistenceInput.value,
        filetreeInteractionByScope: filetreeInteractionByScope.value,
      },
      toValue(routedWorkspaceId) ?? lastRoutedWorkspaceId,
    )

  const flushLatestClientWorkspace = async () => {
    if (debounceTimer !== null) {
      window.clearTimeout(debounceTimer)
      debounceTimer = null
    }
    const workspace = latestClientWorkspace()
    if (!workspace) return
    await writeClientWorkspaceState(workspace)
  }

  const flushClientWorkspaceInBackground = () => {
    void flushLatestClientWorkspace().catch(() => {})
  }

  // This is the persistence boundary: every accepted restorable-state change
  // schedules exactly one immediate or debounced write of the complete snapshot.
  // Quit and page-lifecycle flushes below only reduce the chance of losing the
  // final debounce window; they are not an ownership or correctness boundary.
  const unsubscribeAppQuitting = subscribeAppQuitting(flushLatestClientWorkspace)
  watch(
    [persistenceInput, workspacePaneTabsVersion, filetreeInteractionByScope, () => toValue(routedWorkspaceId)],
    () => {
      const currentRoutedWorkspaceId = toValue(routedWorkspaceId)
      if (currentRoutedWorkspaceId) lastRoutedWorkspaceId = currentRoutedWorkspaceId
      let workspace: ClientWorkspaceState | null
      try {
        workspace = latestClientWorkspace()
      } catch (err) {
        sessionLog.warn('local workspace save blocked', { err })
        return
      }
      if (!workspace) return
      const immediateKey = JSON.stringify({
        restoredWorkspaceId: workspace.restoredWorkspaceId,
        zenMode: workspace.zenMode,
        workspacePaneSize: workspace.workspacePaneSize,
      })
      const immediate = immediateKey !== lastImmediateKey
      lastImmediateKey = immediateKey
      if (immediate) {
        flushClientWorkspaceInBackground()
        return
      }
      if (debounceTimer !== null) window.clearTimeout(debounceTimer)
      debounceTimer = window.setTimeout(flushClientWorkspaceInBackground, CLIENT_WORKSPACE_SAVE_DEBOUNCE_MS)
    },
    { immediate: true },
  )

  const flushWhenHidden = () => {
    if (document.visibilityState === 'hidden') flushClientWorkspaceInBackground()
  }
  window.addEventListener('pagehide', flushClientWorkspaceInBackground)
  window.addEventListener('beforeunload', flushClientWorkspaceInBackground)
  document.addEventListener('visibilitychange', flushWhenHidden)
  onScopeDispose(() => {
    unsubscribeAppQuitting()
    if (debounceTimer !== null) window.clearTimeout(debounceTimer)
    window.removeEventListener('pagehide', flushClientWorkspaceInBackground)
    window.removeEventListener('beforeunload', flushClientWorkspaceInBackground)
    document.removeEventListener('visibilitychange', flushWhenHidden)
  })
}

function clientWorkspaceFromPersistenceInput(
  input: ClientWorkspacePersistenceInput,
  lastRoutedWorkspaceId: WorkspaceId | null,
): ClientWorkspaceState | null {
  if (!workspaceSessionPersistenceOpenFromStore(input)) return null
  return clientWorkspaceStateFromRestorableWorkspaceState({
    workspaces: input.workspaces,
    restorableWorkspaceState: restorableWorkspaceStateFromStore({
      workspaceOrder: input.workspaceOrder,
      restoredWorkspaceId: lastRoutedWorkspaceId ?? input.restoredWorkspaceId,
      zenMode: input.zenMode,
      workspacePaneSize: input.workspacePaneSize,
      selectedTerminalSessionIdByTerminalFilesystemTarget: input.selectedTerminalSessionIdByTerminalFilesystemTarget,
      branchViewModeByWorkspace: input.branchViewModeByWorkspace,
    }),
    filetreeInteractionByScope: input.filetreeInteractionByScope,
    restoredClientWorkspaceBaseline: input.restoredClientWorkspaceBaseline,
  })
}

function useWorkspacePaneTabsCacheVersion() {
  const version = shallowRef(workspacePaneTabsPersistenceSnapshot())
  const unsubscribe = subscribeWorkspacePaneTabsPersistenceChanges(() => {
    version.value = workspacePaneTabsPersistenceSnapshot()
  })
  onScopeDispose(unsubscribe)
  return version
}
