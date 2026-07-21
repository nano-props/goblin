import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { appRealtimeClient } from '#/web/app-realtime.ts'
import { readOrCreateWebTerminalClientId } from '#/web/client-terminal-id.ts'
import { terminalClient } from '#/web/terminal.ts'
import { appRuntimeProjectionLog } from '#/web/logger.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { useTerminalProjectionHydrationStore } from '#/web/stores/terminal-projection-hydration.ts'
import { useTerminalSessionProjection } from '#/web/components/terminal/use-terminal-session-projection.ts'
import { workspacePaneTabsClient } from '#/web/workspace-pane/workspace-pane-tabs-client.ts'
import { writeCanonicalWorkspacePaneTabsSnapshot } from '#/web/workspace-pane/workspace-pane-tabs-commit.ts'
import { workspacePaneTabsProjectionRevision } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import {
  createRuntimeProjectionScopeRegistry,
  type RuntimeProjectionScope,
  type RuntimeProjectionScopeRegistry,
} from '#/web/runtime/runtime-projection-scope.ts'
import { reconcileOpenWorkspaceRuntimeMemberships } from '#/web/stores/workspaces/workspace-session-write-paths.ts'
import { canonicalWorkspaceLocator, type WorkspaceId } from '#/shared/workspace-locator.ts'
import { invalidateRepoWorktreeSnapshotQueries } from '#/web/repo-query-runtime.ts'
import { gitWorkspaceCanExecute } from '#/web/stores/workspaces/workspace-guards.ts'
import { AppTerminalProjectionRecovery } from '#/web/runtime/app-terminal-projection-recovery.ts'
import { WorkspacePaneTabsRecovery } from '#/web/runtime/workspace-pane-tabs-recovery.ts'
import { WorkspaceRuntimeReconnectRecovery } from '#/web/runtime/workspace-runtime-reconnect-recovery.ts'

interface AppRuntimeProjectionProviderProps {
  children: ReactNode
  currentWorkspaceId: WorkspaceId | null
}

export function AppRuntimeProjectionProvider({ children, currentWorkspaceId }: AppRuntimeProjectionProviderProps) {
  const currentWorkspaceRuntimeId = useWorkspacesStore((s) =>
    currentWorkspaceId ? (s.workspaces[currentWorkspaceId]?.workspaceRuntimeId ?? null) : null,
  )
  const workspaceMembershipReady = useWorkspacesStore((s) => s.workspaceMembershipReady)
  const terminalProjection = useTerminalSessionProjection()
  const [scopeRegistry] = useState(() =>
    createRuntimeProjectionScopeRegistry(
      (target) =>
        useWorkspacesStore.getState().workspaceMembershipReady &&
        workspaceRuntimeIdForRoot(target.workspaceId) === target.workspaceRuntimeId,
    ),
  )
  const [terminalRecovery] = useState(
    () =>
      new AppTerminalProjectionRecovery({
        projection: terminalProjection,
        readClientId: readOrCreateWebTerminalClientId,
        recoverSessions: async (target) => await terminalClient.recoverSessions(target),
        hydrationEntry: (workspaceId) =>
          useTerminalProjectionHydrationStore.getState().hydrationByWorkspace.get(workspaceId),
        beginHydration: (workspaceId, workspaceRuntimeId) =>
          useTerminalProjectionHydrationStore.getState().beginProjectionHydration(workspaceId, workspaceRuntimeId),
        markReady: (workspaceId, workspaceRuntimeId) =>
          useTerminalProjectionHydrationStore.getState().markProjectionReady(workspaceId, workspaceRuntimeId),
        markFailed: (workspaceId, workspaceRuntimeId, errorMessage) =>
          useTerminalProjectionHydrationStore
            .getState()
            .markProjectionFailed(workspaceId, workspaceRuntimeId, errorMessage),
        shouldRefresh: (workspaceId) =>
          useTerminalProjectionHydrationStore.getState().shouldRefreshProjection(workspaceId),
        logFailure: (error) =>
          appRuntimeProjectionLog.debug('failed to reconcile terminal sessions from server', { error }),
      }),
  )
  const [workspaceTabsRecovery] = useState(
    () =>
      new WorkspacePaneTabsRecovery({
        list: async (target) => await workspacePaneTabsClient.list(target),
        commit: (target, snapshot) =>
          writeCanonicalWorkspacePaneTabsSnapshot(target.workspaceId, target.workspaceRuntimeId, snapshot),
        currentRevision: (target) => workspacePaneTabsProjectionRevision(target.workspaceId, target.workspaceRuntimeId),
        logFailure: (target, error) => {
          appRuntimeProjectionLog.debug('failed to refresh workspace pane tabs', { ...target, error })
        },
      }),
  )
  const [reconnectRecovery] = useState(
    () =>
      new WorkspaceRuntimeReconnectRecovery({
        scopeRegistry,
        reconcileMemberships: async () =>
          // Reconnect-only admission: the server resolves these stable workspace IDs and
          // mints the canonical runtime epochs; this is not a client-owned membership snapshot.
          await reconcileOpenWorkspaceRuntimeMemberships(useWorkspacesStore.setState, useWorkspacesStore.getState),
        currentWorkspaceRuntimeId: workspaceRuntimeIdForRoot,
        terminalRecovery,
        workspaceTabsRecovery,
        logFailure: (error) => {
          appRuntimeProjectionLog.warn('failed to reconcile workspace runtime memberships after realtime recovery', {
            error,
          })
        },
      }),
  )
  const refreshCurrentWorkspaceStatus = useCallback(() => {
    if (!workspaceMembershipReady || !currentWorkspaceId || !currentWorkspaceRuntimeId) return
    const workspace = useWorkspacesStore.getState().workspaces[currentWorkspaceId]
    if (
      !workspace ||
      workspace.workspaceRuntimeId !== currentWorkspaceRuntimeId ||
      !gitWorkspaceCanExecute(workspace)
    ) {
      return
    }
    invalidateRepoWorktreeSnapshotQueries(currentWorkspaceId, currentWorkspaceRuntimeId)
  }, [currentWorkspaceId, currentWorkspaceRuntimeId, workspaceMembershipReady])

  useEffect(() => () => scopeRegistry.disposeScopes(), [scopeRegistry])

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return
      appRealtimeClient.kickReconnect()
      refreshCurrentWorkspaceStatus()
    }
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return
      appRealtimeClient.kickReconnect()
      refreshCurrentWorkspaceStatus()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('pageshow', onPageShow)
    const offVisibility = scopeRegistry.track(() =>
      document.removeEventListener('visibilitychange', onVisibilityChange),
    )
    const offPageShow = scopeRegistry.track(() => window.removeEventListener('pageshow', onPageShow))
    return () => {
      offVisibility()
      offPageShow()
    }
  }, [refreshCurrentWorkspaceStatus, scopeRegistry])

  useEffect(() => {
    if (!workspaceMembershipReady || !currentWorkspaceId || !currentWorkspaceRuntimeId) return
    const target = { workspaceId: currentWorkspaceId, workspaceRuntimeId: currentWorkspaceRuntimeId }
    const scope = scopeRegistry.scopeFor(target)
    refreshCurrentWorkspaceStatus()
    terminalRecovery.begin(scope)
    terminalRecovery.request(scope)

    const handleFocus = () => {
      refreshCurrentWorkspaceStatus()
      const currentScope = scopeRegistry.scopeFor(target)
      currentScope.commit(() => {
        if (!terminalRecovery.shouldRefresh(currentScope.target.workspaceId)) return
        terminalRecovery.request(currentScope)
      })
    }
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [
    workspaceMembershipReady,
    currentWorkspaceId,
    currentWorkspaceRuntimeId,
    terminalRecovery,
    scopeRegistry,
    refreshCurrentWorkspaceStatus,
  ])

  useEffect(() => {
    if (!workspaceMembershipReady) {
      scopeRegistry.disposeScopes()
      return
    }
    const offSessionsChanged = scopeRegistry.track(
      terminalClient.onSessionsChanged((event) => {
        const scope = currentScopeForWorkspace(scopeRegistry, event.workspaceId)
        if (!scope) return
        if (scope.target.workspaceRuntimeId !== event.workspaceRuntimeId) return
        const hydration = useTerminalProjectionHydrationStore.getState().hydrationByWorkspace.get(event.workspaceId)
        const ready = hydration?.workspaceRuntimeId === event.workspaceRuntimeId && hydration.phase === 'ready'
        const localRevision = terminalProjection.terminalSessionsCatalogCoverageRevision(scope.target) ?? -1
        if (ready && localRevision >= event.revision) return
        terminalRecovery.request(scope, { minimumRevision: event.revision })
      }),
    )
    const offRecovered = scopeRegistry.track(appRealtimeClient.onRecovered(() => reconnectRecovery.request()))
    const offWorkspaceTabsChanged = scopeRegistry.track(
      workspacePaneTabsClient.onChanged((message) => {
        const scope = currentScopeForWorkspace(scopeRegistry, message.workspaceId)
        if (!scope) return
        workspaceTabsRecovery.handleChanged(scope, message)
      }),
    )
    return () => {
      reconnectRecovery.invalidate()
      offSessionsChanged()
      offRecovered()
      offWorkspaceTabsChanged()
    }
  }, [
    workspaceMembershipReady,
    reconnectRecovery,
    scopeRegistry,
    terminalProjection,
    terminalRecovery,
    workspaceTabsRecovery,
  ])

  return <>{children}</>
}

function currentScopeForWorkspace(
  registry: RuntimeProjectionScopeRegistry,
  workspaceIdInput: string,
): RuntimeProjectionScope | null {
  const workspaceId = canonicalWorkspaceLocator(workspaceIdInput)
  if (!workspaceId) return null
  const workspaceRuntimeId = workspaceRuntimeIdForRoot(workspaceId)
  return workspaceRuntimeId ? registry.scopeFor({ workspaceId: workspaceId, workspaceRuntimeId }) : null
}

function workspaceRuntimeIdForRoot(workspaceId: WorkspaceId): string | null {
  return useWorkspacesStore.getState().workspaces[workspaceId]?.workspaceRuntimeId ?? null
}
