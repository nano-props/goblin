import { computed, defineComponent, onScopeDispose, ref, Teleport, watch } from 'vue'
import { RefreshCw, TriangleAlert } from '@lucide/vue'
import { appRealtimeClient } from '#/web/app/realtime/index.ts'
import { readClientPageId } from '#/web/bridge/page-id.ts'
import { terminalClient } from '#/web/terminal/client-facade.ts'
import { appRuntimeProjectionLog } from '#/web/logger.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { terminalProjectionHydrationStore } from '#/web/stores/terminal-projection-hydration.ts'
import { useTerminalSessionProjection } from '#/web/terminal/components/use-terminal-session-projection.ts'
import { workspacePaneTabsClient } from '#/web/workspace-pane/workspace-pane-tabs-client.ts'
import {
  refreshWorkspacePaneTabsQueryData,
  workspacePaneTabsProjectionRevision,
} from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { createRuntimeProjectionScopeRegistry } from '#/web/runtime/runtime-projection-scope.ts'
import type { RuntimeProjectionScope, RuntimeProjectionScopeRegistry } from '#/web/runtime/runtime-projection-scope.ts'
import { reconcileOpenWorkspaceRuntimeMemberships } from '#/web/stores/workspaces/workspace-runtime-membership-recovery.ts'
import { canonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { AppTerminalProjectionRecovery } from '#/web/runtime/app-terminal-projection-recovery.ts'
import { WorkspacePaneTabsRecovery } from '#/web/runtime/workspace-pane-tabs-recovery.ts'
import { WorkspaceRuntimeProjectionRecovery } from '#/web/runtime/workspace-runtime-projection-recovery.ts'
import { useStoreSelector } from '#/web/stores/store-selector.ts'
import { provideTerminalProjectionRecoveryActions } from '#/web/runtime/terminal-projection-recovery-context.ts'
import { provideWorkspacePaneTabsRetryActions } from '#/web/runtime/workspace-pane-tabs-recovery-context.ts'
import { provideWorkspaceRuntimeRecoveryActions } from '#/web/runtime/workspace-runtime-recovery-context.ts'
import { useRepoStoreInvalidationRefresh } from '#/web/hooks/useRepoStoreInvalidationRefresh.ts'
import { resyncActiveRepoReadQueries } from '#/web/stores/workspaces/repo-refresh-actions.ts'
import { subscribeServerCommandGenerationAdvance } from '#/web/lib/server-command-generation.ts'
import { Button } from '#/web/components/ui/button.tsx'
import { STATUS_TONE_CHIP_CLASS } from '#/web/components/ui/status-tones.ts'
import { useT } from '#/web/stores/i18n-vue.ts'

export const AppRuntimeProjectionProvider = defineComponent<{ currentWorkspaceId: WorkspaceId | null }>({
  name: 'AppRuntimeProjectionProvider',
  props: ['currentWorkspaceId'],

  setup(props, { slots }) {
    const t = useT()
    // This is presentation state for the document-local recovery workflow,
    // never workspace or runtime authority.
    const recoveryFailed = ref(false)
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
      recoverSessions: (target) => terminalClient.recoverSessions(target),
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
      refresh: (target, requirement) =>
        refreshWorkspacePaneTabsQueryData(target.workspaceId, target.workspaceRuntimeId, { requirement }),
      currentRevision: (target) => workspacePaneTabsProjectionRevision(target.workspaceId, target.workspaceRuntimeId),
      logFailure: (target, error) => {
        appRuntimeProjectionLog.debug('failed to refresh workspace pane tabs', { ...target, error })
      },
    })
    const projectionRecovery = new WorkspaceRuntimeProjectionRecovery({
      scopeRegistry,
      reconcileMemberships: () =>
        reconcileOpenWorkspaceRuntimeMemberships(workspacesStore.setState, workspacesStore.getState),
      currentWorkspaceRuntimeId: workspaceRuntimeIdForRoot,
      terminalRecovery,
      workspaceTabsRecovery,
      resyncRepoReads: () =>
        resyncActiveRepoReadQueries({
          get: workspacesStore.getState,
        }),
      setRecoveryFailed: (failed) => {
        recoveryFailed.value = failed
      },
      logFailure: (error) => {
        appRuntimeProjectionLog.warn('failed to recover runtime projections', { error })
      },
    })
    // Complete membership recovery belongs to the authenticated app lifecycle,
    // even without an active workspace route; re-declare it after a command
    // reset so interrupted recovery cannot leave projections stale.
    const offGenerationAdvance = subscribeServerCommandGenerationAdvance(() => {
      if (workspacesStore.getState().workspaceMembershipReady) projectionRecovery.request()
    })
    useRepoStoreInvalidationRefresh(() => {
      if (workspacesStore.getState().workspaceMembershipReady) projectionRecovery.request()
    })
    provideWorkspaceRuntimeRecoveryActions({ request: () => projectionRecovery.request() })
    const projectionScopeForWorkspace = (workspaceId: WorkspaceId) => {
      const workspaceRuntimeId = workspaceRuntimeIdForRoot(workspaceId)
      return workspaceRuntimeId ? scopeRegistry.scopeFor({ workspaceId, workspaceRuntimeId }) : null
    }
    provideTerminalProjectionRecoveryActions({
      retryWorkspace(workspaceId) {
        const scope = projectionScopeForWorkspace(workspaceId)
        if (scope) terminalRecovery.retry(scope)
      },
    })
    provideWorkspacePaneTabsRetryActions({
      retryWorkspace(workspaceId) {
        const scope = projectionScopeForWorkspace(workspaceId)
        if (scope) workspaceTabsRecovery.request(scope, { kind: 'fresh' })
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
        const offRecovered = appRealtimeClient.onRecovered(() => projectionRecovery.request())
        const offWorkspaceTabsChanged = workspacePaneTabsClient.onChanged((message) => {
          const scope = currentScopeForWorkspace(scopeRegistry, message.workspaceId)
          if (scope) workspaceTabsRecovery.handleChanged(scope, message)
        })
        onCleanup(() => {
          projectionRecovery.invalidate()
          offSessionsChanged()
          offRecovered()
          offWorkspaceTabsChanged()
        })
      },
      { immediate: true },
    )

    onScopeDispose(() => {
      offGenerationAdvance()
      projectionRecovery.invalidate()
      scopeRegistry.disposeScopes()
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pageshow', onPageShow)
    })

    return () => (
      <>
        {slots.default?.()}
        {recoveryFailed.value ? (
          <Teleport to="body">
            <div
              data-testid="workspace-runtime-recovery-failure"
              role="alert"
              class="fixed left-4 right-4 top-12 z-40 rounded-md border border-warning-border bg-popover p-3 text-popover-foreground shadow-md min-[601px]:left-auto min-[601px]:w-[420px]"
            >
              <div class="flex items-start gap-3">
                <div
                  class={[
                    'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border',
                    STATUS_TONE_CHIP_CLASS.warning,
                  ]}
                >
                  <TriangleAlert class="size-4" />
                </div>
                <div class="min-w-0 flex-1">
                  <div class="text-xs font-semibold leading-5">{t('runtime-recovery.failed-title')}</div>
                  <div class="mt-0.5 break-words text-xs leading-5 text-muted-foreground">
                    {t('runtime-recovery.failed-description')}
                  </div>
                  <div class="mt-2.5">
                    <Button type="button" size="sm" variant="outline" onClick={() => projectionRecovery.request()}>
                      <RefreshCw />
                      {t('error.try-again')}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </Teleport>
        ) : null}
      </>
    )
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
