import { onScopeDispose, toValue, watch } from 'vue'
import type { MaybeRefOrGetter } from 'vue'
import { toast } from 'vue-sonner'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { onClientLocalEventType } from '#/web/bridge/local-events.ts'
import { subscribeServerClientIntentIngress } from '#/web/realtime/client-intent-ingress.ts'
import { intentLog } from '#/web/logger.ts'
import { useT } from '#/web/stores/i18n-vue.ts'
import {
  handleTerminalBellClickIntent,
  handleWorkspaceClientIntent,
} from '#/web/hooks/client-effect-intent-handlers.ts'
import type { AppNavigationActions } from '#/web/app/navigation/actions.ts'
import type { ClientEffectIntent } from '#/shared/client-effect-intents.ts'
import type { WorkspacePaneCommandTarget } from '#/web/workspace-pane/workspace-pane-command-target.ts'
import type { AuthenticatedAppBootstrapState } from '#/web/app/bootstrap/authenticated.ts'
import { isShortcutBlockingLayerOpen } from '#/web/lib/layers.ts'
import { terminalSessionCoordinates } from '#/shared/terminal-types.ts'
import { hasErrorCode } from '#/shared/error-code.ts'

interface ClientEffectIntentRouterOptions {
  authenticatedBootstrapState: MaybeRefOrGetter<AuthenticatedAppBootstrapState>
  navigation: MaybeRefOrGetter<AppNavigationActions>
  currentWorkspaceId: MaybeRefOrGetter<WorkspaceId | null>
  currentWorkspacePaneCommandTarget: MaybeRefOrGetter<WorkspacePaneCommandTarget | null>
  closeAllOverlays: () => void
  isOverlayOpen: () => boolean
  isWorkspaceShortcutSuppressed: () => boolean
}

export function useClientEffectIntentRouter(options: ClientEffectIntentRouterOptions) {
  // This hook is the single client-side subscription point for server effect
  // intents. Routing stays centralized here; intent-specific behavior lives in
  // the handler/plan helpers so components do not subscribe independently.
  const t = useT()
  const readTerminalBellDeps = (intent: Extract<ClientEffectIntent, { type: 'terminal-bell-click' }>) => {
    const workspaceId = terminalSessionCoordinates(intent.session).workspaceId
    return {
      navigation: toValue(options.navigation),
      closeAllOverlays: options.closeAllOverlays,
      terminalBellWorkspace: workspacesStore.getState().workspaces[workspaceId] ?? null,
    }
  }
  const readWorkspaceIntentDeps = () => {
    const currentWorkspaceId = toValue(options.currentWorkspaceId)
    return {
      navigation: toValue(options.navigation),
      currentWorkspace: currentWorkspaceId ? (workspacesStore.getState().workspaces[currentWorkspaceId] ?? null) : null,
      currentWorkspacePaneCommandTarget: toValue(options.currentWorkspacePaneCommandTarget),
      overlayBlocked: options.isOverlayOpen() || isShortcutBlockingLayerOpen(),
      workspaceShortcutSuppressed: options.isWorkspaceShortcutSuppressed(),
      t: (key: string) => t(key),
    }
  }

  let disposed = false
  let pendingIntents: ClientEffectIntent[] = []

  // Every ingress uses this one routing boundary.
  const execute = (intent: ClientEffectIntent) => {
    if (disposed) return
    void executeClientEffectIntent(intent).catch((err) => {
      intentLog.warn(`${intent.type} failed`, { err })
      if (hasErrorCode(err, 'OUTCOME_UNCERTAIN')) {
        const messageKey = 'error.operation-outcome-uncertain'
        toast.warning(t(messageKey), { id: 'intent-operation-outcome-uncertain' })
      }
    })
  }

  const executeClientEffectIntent = async (intent: ClientEffectIntent): Promise<void> => {
    switch (intent.type) {
      case 'terminal-bell-click':
        handleTerminalBellClickIntent(intent, readTerminalBellDeps(intent))
        return
      case 'show-workspace-pane-tab-requested':
        await handleWorkspaceClientIntent(intent, readWorkspaceIntentDeps())
        return
    }
  }

  const rejectIntent = (intent: ClientEffectIntent) => {
    intentLog.warn(`${intent.type} rejected because authenticated bootstrap failed`)
    toast.error(t('workspace-restore.failed'))
  }

  const dispatch = (intent: ClientEffectIntent) => {
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
    },
    { flush: 'sync', immediate: true },
  )

  const offServerIntent = subscribeServerClientIntentIngress(dispatch)
  const offLocalBellClick = onClientLocalEventType('terminal-bell-click', (event) => {
    dispatch(event)
  })

  onScopeDispose(() => {
    disposed = true
    pendingIntents = []
    offServerIntent()
    offLocalBellClick()
  })
}
