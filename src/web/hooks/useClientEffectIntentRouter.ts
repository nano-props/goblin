import { onScopeDispose, toValue } from 'vue'
import type { MaybeRefOrGetter } from 'vue'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { onClientLocalEventType } from '#/web/local-events.ts'
import { subscribeClientEffectIntent } from '#/web/client-ingress.ts'
import { subscribeServerClientIntentIngress } from '#/web/server-client-intent-ingress.ts'
import { intentLog } from '#/web/logger.ts'
import { useT } from '#/web/stores/i18n-vue.ts'
import {
  createExternalOpenIntentDrainer,
  handleAppLevelClientIntent,
  handleTerminalBellClickIntent,
  handleWorkspaceClientIntent,
} from '#/web/hooks/client-effect-intent-handlers.ts'
import type { AppNavigationActions } from '#/web/app-navigation-actions.ts'
import type { WorkspaceSessionEntry } from '#/shared/remote-workspace.ts'
import type { ClientEffectIntent } from '#/shared/client-effect-intents.ts'
import { clientEffectIntentStoreActionsFromStore } from '#/web/stores/workspaces/selector-actions.ts'
import type { WorkspacePaneCommandTarget } from '#/web/workspace-pane/workspace-pane-command-target.ts'

interface ClientEffectIntentRouterOptions {
  navigation: MaybeRefOrGetter<AppNavigationActions>
  currentWorkspaceId: MaybeRefOrGetter<WorkspaceId | null>
  currentWorkspacePaneCommandTarget: MaybeRefOrGetter<WorkspacePaneCommandTarget | null>
  closeAllOverlays: () => void
  openWorkspacePathDialog: () => void
  openCloneRepo: () => void
  openRemoteWorkspace: () => void
  openCreateWorktree: () => void
  isOverlayOpen: () => boolean
  isWorkspaceShortcutSuppressed: () => boolean
}

export function useClientEffectIntentRouter(options: ClientEffectIntentRouterOptions) {
  // This hook is the single client-side subscription point for native effect
  // intents. Routing stays centralized here; intent-specific behavior lives in
  // the handler/plan helpers so components do not subscribe independently.
  const { openWorkspaceMembership, resetLayout, toggleZenMode } = clientEffectIntentStoreActionsFromStore(
    workspacesStore.getState(),
  )
  const t = useT()
  const readCurrentDeps = () => ({
    navigation: toValue(options.navigation),
    currentWorkspaceId: toValue(options.currentWorkspaceId),
    currentWorkspacePaneCommandTarget: toValue(options.currentWorkspacePaneCommandTarget),
    closeAllOverlays: options.closeAllOverlays,
    openWorkspacePathDialog: options.openWorkspacePathDialog,
    openCloneRepo: options.openCloneRepo,
    openRemoteWorkspace: options.openRemoteWorkspace,
    openCreateWorktree: options.openCreateWorktree,
    isOverlayOpen: options.isOverlayOpen,
    isWorkspaceShortcutSuppressed: options.isWorkspaceShortcutSuppressed,
    openWorkspaceMembership: async (input: string | WorkspaceSessionEntry) => await openWorkspaceMembership(input),
    resetLayout,
    toggleZenMode,
    t: (key: string) => t(key),
  })

  const externalOpenDrainer = createExternalOpenIntentDrainer({
    openWorkspaceMembership: async (path) => await readCurrentDeps().openWorkspaceMembership(path),
    activateWorkspace: (workspaceId) => readCurrentDeps().navigation.activateWorkspace(workspaceId),
    t: (key) => readCurrentDeps().t(key),
  })
  let disposed = false
  let intentQueue = Promise.resolve()

  const sharedDeps = () => readCurrentDeps()

  // One dispatch closure fed by both ingresses. Adding a new
  // producer (Electron IPC, server WS, future transports) is a
  // one-line `subscribe*(dispatch)` below — no copy of the
  // switch / handler chain.
  const dispatch = (intent: ClientEffectIntent) => {
    intentQueue = intentQueue
      .catch(() => undefined)
      .then(async () => {
        if (disposed) return
        try {
          switch (intent.type) {
            case 'terminal-bell-click':
              handleTerminalBellClickIntent(intent, sharedDeps())
              return
            case 'external-open-enqueued':
              externalOpenDrainer.drain()
              return
          }
          if (await handleAppLevelClientIntent(intent, sharedDeps())) return
          if (await handleWorkspaceClientIntent(intent, sharedDeps())) return
        } catch (err) {
          intentLog.warn(`${intent.type} failed`, { err })
        }
      })
  }

  const offIntent = subscribeClientEffectIntent(dispatch)
  const offServerIntent = subscribeServerClientIntentIngress(dispatch)
  const offLocalBellClick = onClientLocalEventType('terminal-bell-click', (event) => {
    handleTerminalBellClickIntent(event, sharedDeps())
  })

  externalOpenDrainer.drain()

  onScopeDispose(() => {
    disposed = true
    externalOpenDrainer.dispose()
    offIntent()
    offServerIntent()
    offLocalBellClick()
  })
}
