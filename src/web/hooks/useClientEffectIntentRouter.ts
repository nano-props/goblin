import { onScopeDispose, toValue, watch } from 'vue'
import type { MaybeRefOrGetter } from 'vue'
import { toast } from 'vue-sonner'
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
import type { AuthenticatedAppBootstrapState } from '#/web/hooks/useAuthenticatedAppBootstrap.ts'
import { isShortcutBlockingLayerOpen } from '#/web/lib/layers.ts'
import { terminalHasKeyboardFocus } from '#/web/terminal-focus.ts'
import { terminalSessionCoordinates } from '#/shared/terminal-types.ts'
import { clientEffectIntentRequiresWorkspaceBootstrap } from '#/web/hooks/client-effect-intent-plans.ts'

interface ClientEffectIntentRouterOptions {
  authenticatedBootstrapState: MaybeRefOrGetter<AuthenticatedAppBootstrapState>
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
  const readTerminalBellDeps = (intent: Extract<ClientEffectIntent, { type: 'terminal-bell-click' }>) => {
    const workspaceId = terminalSessionCoordinates(intent.session).workspaceId
    return {
      navigation: toValue(options.navigation),
      closeAllOverlays: options.closeAllOverlays,
      terminalBellWorkspace: workspacesStore.getState().workspaces[workspaceId] ?? null,
    }
  }
  const readAppIntentDeps = () => ({
    navigation: toValue(options.navigation),
    openWorkspacePathDialog: options.openWorkspacePathDialog,
    openCloneRepo: options.openCloneRepo,
    openRemoteWorkspace: options.openRemoteWorkspace,
    overlayBlocked: options.isOverlayOpen() || isShortcutBlockingLayerOpen(),
    openWorkspaceMembership: async (input: string | WorkspaceSessionEntry) => await openWorkspaceMembership(input),
    resetLayout,
    t: (key: string) => t(key),
  })
  const readWorkspaceIntentDeps = () => {
    const currentWorkspaceId = toValue(options.currentWorkspaceId)
    return {
      navigation: toValue(options.navigation),
      currentWorkspace: currentWorkspaceId ? (workspacesStore.getState().workspaces[currentWorkspaceId] ?? null) : null,
      currentWorkspacePaneCommandTarget: toValue(options.currentWorkspacePaneCommandTarget),
      openCreateWorktree: options.openCreateWorktree,
      overlayBlocked: options.isOverlayOpen() || isShortcutBlockingLayerOpen(),
      workspaceShortcutSuppressed: options.isWorkspaceShortcutSuppressed(),
      terminalFocused: terminalHasKeyboardFocus(),
      toggleZenMode,
      t: (key: string) => t(key),
    }
  }

  const externalOpenDrainer = createExternalOpenIntentDrainer({
    openWorkspaceMembership: async (path) => await openWorkspaceMembership(path),
    activateWorkspace: (workspaceId) => toValue(options.navigation).activateWorkspace(workspaceId),
    t: (key) => t(key),
  })
  let disposed = false
  let pendingIntents: ClientEffectIntent[] = []

  // Every ingress uses this one routing boundary.
  const execute = (intent: ClientEffectIntent) => {
    if (disposed) return
    void executeClientEffectIntent(intent).catch((err) => {
      intentLog.warn(`${intent.type} failed`, { err })
    })
  }

  const executeClientEffectIntent = async (intent: ClientEffectIntent): Promise<void> => {
    switch (intent.type) {
      case 'app-quitting':
        return
      case 'external-open-enqueued':
        externalOpenDrainer.drain()
        return
      case 'terminal-bell-click':
        handleTerminalBellClickIntent(intent, readTerminalBellDeps(intent))
        return
      case 'layout-reset-requested':
      case 'open-settings-requested':
      case 'theme-pref-set-requested':
      case 'lang-pref-set-requested':
      case 'clear-recent-workspaces-requested':
      case 'open-recent-workspace-requested':
      case 'open-workspace-requested':
      case 'open-workspace-path-requested':
      case 'clone-repo-requested':
      case 'open-remote-workspace-requested':
        await handleAppLevelClientIntent(intent, readAppIntentDeps())
        return
      case 'create-worktree-requested':
      case 'terminal-new-tab-requested':
      case 'workspace-pane-close-tab-requested':
      case 'close-workspace-requested':
      case 'cycle-workspace-requested':
      case 'workspace-refresh-requested':
      case 'show-workspace-pane-tab-requested':
      case 'terminal-primary-action-requested':
      case 'workspace-zen-mode-toggle-requested':
        await handleWorkspaceClientIntent(intent, readWorkspaceIntentDeps())
        return
    }
  }

  const rejectIntent = (intent: ClientEffectIntent) => {
    intentLog.warn(`${intent.type} rejected because authenticated bootstrap failed`)
    toast.error(t('workspace-restore.failed'))
  }

  const dispatch = (intent: ClientEffectIntent) => {
    if (intent.type === 'app-quitting') {
      intentLog.warn('app-quitting rejected by the UI intent router')
      return
    }
    if (!clientEffectIntentRequiresWorkspaceBootstrap(intent)) {
      execute(intent)
      return
    }
    const bootstrapState = toValue(options.authenticatedBootstrapState)
    if (bootstrapState.status === 'restoring-workspace') {
      pendingIntents.push(intent)
      return
    }
    if (bootstrapState.status === 'failed') {
      rejectIntent(intent)
      return
    }
    execute(intent)
  }

  watch(
    () => toValue(options.authenticatedBootstrapState),
    (bootstrapState) => {
      if (bootstrapState.status === 'restoring-workspace') return
      const pending = pendingIntents
      pendingIntents = []
      if (bootstrapState.status === 'failed') {
        if (pending.length === 0) return
        for (const intent of pending) intentLog.warn(`${intent.type} rejected because authenticated bootstrap failed`)
        toast.error(t('workspace-restore.failed'))
        return
      }
      for (const intent of pending) execute(intent)
      externalOpenDrainer.drain()
    },
    { flush: 'sync', immediate: true },
  )

  const offIntent = subscribeClientEffectIntent(dispatch)
  const offServerIntent = subscribeServerClientIntentIngress(dispatch)
  const offLocalBellClick = onClientLocalEventType('terminal-bell-click', (event) => {
    dispatch(event)
  })

  onScopeDispose(() => {
    disposed = true
    pendingIntents = []
    externalOpenDrainer.dispose()
    offIntent()
    offServerIntent()
    offLocalBellClick()
  })
}
