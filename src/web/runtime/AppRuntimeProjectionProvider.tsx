import { computed, defineComponent, onScopeDispose, watch } from 'vue'
import { appRealtimeClient } from '#/web/app-realtime.ts'
import { readClientPageId } from '#/web/client-page-id.ts'
import { terminalClient } from '#/web/terminal.ts'
import { appRuntimeProjectionLog } from '#/web/logger.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { terminalProjectionHydrationStore } from '#/web/stores/terminal-projection-hydration.ts'
import { useTerminalSessionProjection } from '#/web/components/terminal/use-terminal-session-projection.ts'
import { workspacePaneTabsClient } from '#/web/workspace-pane/workspace-pane-tabs-client.ts'
import { writeCanonicalWorkspacePaneTabsSnapshot } from '#/web/workspace-pane/workspace-pane-tabs-commit.ts'
import { workspacePaneTabsProjectionRevision } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { createRuntimeProjectionScopeRegistry } from '#/web/runtime/runtime-projection-scope.ts'
import type { RuntimeProjectionScope, RuntimeProjectionScopeRegistry } from '#/web/runtime/runtime-projection-scope.ts'
import { reconcileOpenWorkspaceRuntimeMemberships } from '#/web/stores/workspaces/workspace-runtime-membership-recovery.ts'
import { canonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { AppTerminalProjectionRecovery } from '#/web/runtime/app-terminal-projection-recovery.ts'
import { WorkspacePaneTabsRecovery } from '#/web/runtime/workspace-pane-tabs-recovery.ts'
import { WorkspaceRuntimeReconnectRecovery } from '#/web/runtime/workspace-runtime-reconnect-recovery.ts'
import { useStoreSelector } from '#/web/stores/store-selector.ts'

export const AppRuntimeProjectionProvider = defineComponent<{ currentWorkspaceId: WorkspaceId | null }>({
  name: 'AppRuntimeProjectionProvider',
  props: ['currentWorkspaceId'],

  setup(props, { slots }) {
    const workspaceState = useStoreSelector(workspacesStore, (state) => state)
    const currentWorkspaceRuntimeId = computed(() =>
      props.currentWorkspaceId
        ? (workspaceState.value.workspaces[props.currentWorkspaceId]?.workspaceRuntimeId ?? null)
        : null,
    )
    const workspaceMembershipReady = computed(() => workspaceState.value.workspaceMembershipReady)
    const terminalProjection = useTerminalSessionProjection()
    const scopeRegistry = createRuntimeProjectionScopeRegistry(
      (target) =>
        workspacesStore.getState().workspaceMembershipReady &&
        workspaceRuntimeIdForRoot(target.workspaceId) === target.workspaceRuntimeId,
    )
    const terminalRecovery = new AppTerminalProjectionRecovery({
      projection: terminalProjection,
      readClientId: readClientPageId,
      recoverSessions: async (target) => await terminalClient.recoverSessions(target),
      hydrationEntry: (workspaceId) =>
        terminalProjectionHydrationStore.getState().hydrationByWorkspace.get(workspaceId),
      beginHydration: (workspaceId, workspaceRuntimeId) =>
        terminalProjectionHydrationStore.getState().beginProjectionHydration(workspaceId, workspaceRuntimeId),
      markReady: (workspaceId, workspaceRuntimeId) =>
        terminalProjectionHydrationStore.getState().markProjectionReady(workspaceId, workspaceRuntimeId),
      markFailed: (workspaceId, workspaceRuntimeId, errorMessage) =>
        terminalProjectionHydrationStore.getState().markProjectionFailed(workspaceId, workspaceRuntimeId, errorMessage),
      isFocusRefreshDue: (workspaceId, workspaceRuntimeId) =>
        terminalProjectionHydrationStore.getState().isProjectionFocusRefreshDue(workspaceId, workspaceRuntimeId),
      logFailure: (error) =>
        appRuntimeProjectionLog.debug('failed to reconcile terminal sessions from server', { error }),
    })
    const workspaceTabsRecovery = new WorkspacePaneTabsRecovery({
      list: async (target) => await workspacePaneTabsClient.list(target),
      commit: (target, snapshot) =>
        writeCanonicalWorkspacePaneTabsSnapshot(target.workspaceId, target.workspaceRuntimeId, snapshot),
      currentRevision: (target) => workspacePaneTabsProjectionRevision(target.workspaceId, target.workspaceRuntimeId),
      logFailure: (target, error) => {
        appRuntimeProjectionLog.debug('failed to refresh workspace pane tabs', { ...target, error })
      },
    })
    const reconnectRecovery = new WorkspaceRuntimeReconnectRecovery({
      scopeRegistry,
      reconcileMemberships: async () =>
        await reconcileOpenWorkspaceRuntimeMemberships(workspacesStore.setState, workspacesStore.getState),
      currentWorkspaceRuntimeId: workspaceRuntimeIdForRoot,
      terminalRecovery,
      workspaceTabsRecovery,
      logFailure: (error) => {
        appRuntimeProjectionLog.warn('failed to reconcile workspace runtime memberships after realtime recovery', {
          error,
        })
      },
    })

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') appRealtimeClient.kickReconnect()
    }
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) appRealtimeClient.kickReconnect()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('pageshow', onPageShow)

    // The active runtime scope changes only when route identity or hydrated
    // runtime ownership changes. Its focus listener belongs to that scope.
    watch(
      [workspaceMembershipReady, () => props.currentWorkspaceId, currentWorkspaceRuntimeId],
      ([ready, workspaceId, workspaceRuntimeId], _previous, onCleanup) => {
        if (!ready || !workspaceId || !workspaceRuntimeId) return
        const target = { workspaceId, workspaceRuntimeId }
        const scope = scopeRegistry.scopeFor(target)
        terminalRecovery.begin(scope, { kind: 'initial' })

        const handleFocus = () => {
          const currentScope = scopeRegistry.scopeFor(target)
          currentScope.commit(() => {
            if (!terminalRecovery.isFocusRefreshDue(currentScope.target)) return
            terminalRecovery.request(currentScope, { kind: 'minimum-revision', revision: 0 })
          })
        }
        window.addEventListener('focus', handleFocus)
        onCleanup(() => window.removeEventListener('focus', handleFocus))
      },
      { immediate: true },
    )

    // Realtime subscriptions exist only while workspace membership is
    // authoritative; losing that boundary invalidates all runtime scopes.
    watch(
      workspaceMembershipReady,
      (ready, _previous, onCleanup) => {
        if (!ready) {
          scopeRegistry.disposeScopes()
          return
        }
        const offSessionsChanged = terminalClient.onSessionsChanged((event) => {
          const scope = currentScopeForWorkspace(scopeRegistry, event.workspaceId)
          if (!scope || scope.target.workspaceRuntimeId !== event.workspaceRuntimeId) return
          const hydration = terminalProjectionHydrationStore.getState().hydrationByWorkspace.get(event.workspaceId)
          const hydrated = hydration?.workspaceRuntimeId === event.workspaceRuntimeId && hydration.phase === 'ready'
          const localRevision = terminalProjection.terminalSessionsCatalogCoverageRevision(scope.target) ?? -1
          if (hydrated && localRevision >= event.revision) return
          terminalRecovery.request(scope, { kind: 'minimum-revision', revision: event.revision })
        })
        const offRecovered = appRealtimeClient.onRecovered(() => reconnectRecovery.request())
        const offWorkspaceTabsChanged = workspacePaneTabsClient.onChanged((message) => {
          const scope = currentScopeForWorkspace(scopeRegistry, message.workspaceId)
          if (scope) workspaceTabsRecovery.handleChanged(scope, message)
        })
        onCleanup(() => {
          reconnectRecovery.invalidate()
          offSessionsChanged()
          offRecovered()
          offWorkspaceTabsChanged()
        })
      },
      { immediate: true },
    )

    onScopeDispose(() => {
      reconnectRecovery.invalidate()
      scopeRegistry.disposeScopes()
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pageshow', onPageShow)
    })

    return () => slots.default?.()
  },
})

function currentScopeForWorkspace(
  registry: RuntimeProjectionScopeRegistry,
  workspaceIdInput: string,
): RuntimeProjectionScope | null {
  const workspaceId = canonicalWorkspaceLocator(workspaceIdInput)
  if (!workspaceId) return null
  const workspaceRuntimeId = workspaceRuntimeIdForRoot(workspaceId)
  return workspaceRuntimeId ? registry.scopeFor({ workspaceId, workspaceRuntimeId }) : null
}

function workspaceRuntimeIdForRoot(workspaceId: WorkspaceId): string | null {
  return workspacesStore.getState().workspaces[workspaceId]?.workspaceRuntimeId ?? null
}
