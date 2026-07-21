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
import { TerminalProjectionRecoveryCoordinator } from '#/web/runtime/terminal-projection-recovery.ts'
import { canonicalWorkspaceLocator, type WorkspaceId } from '#/shared/workspace-locator.ts'
import { invalidateRepoWorktreeSnapshotQueries } from '#/web/repo-query-runtime.ts'
import { gitWorkspaceCanExecute } from '#/web/stores/workspaces/workspace-guards.ts'

interface AppRuntimeProjectionProviderProps {
  children: ReactNode
  currentWorkspaceId: WorkspaceId | null
}

const WORKSPACE_TABS_REFRESH_LANE = 'workspace-tabs-refresh'

export function AppRuntimeProjectionProvider({ children, currentWorkspaceId }: AppRuntimeProjectionProviderProps) {
  const currentWorkspaceRuntimeId = useWorkspacesStore((s) =>
    currentWorkspaceId ? (s.workspaces[currentWorkspaceId]?.workspaceRuntimeId ?? null) : null,
  )
  const workspaceMembershipReady = useWorkspacesStore((s) => s.workspaceMembershipReady)
  const terminalProjection = useTerminalSessionProjection()
  const [terminalRecovery] = useState(() => new TerminalProjectionRecoveryCoordinator())
  const [scopeRegistry] = useState(() =>
    createRuntimeProjectionScopeRegistry(
      (target) =>
        useWorkspacesStore.getState().workspaceMembershipReady &&
        workspaceRuntimeIdForRoot(target.workspaceId) === target.workspaceRuntimeId,
    ),
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

  const refreshWorkspacePaneTabsForScope = useCallback((scope: RuntimeProjectionScope): void => {
    scope.runLatest(
      WORKSPACE_TABS_REFRESH_LANE,
      async () =>
        await workspacePaneTabsClient.list({
          workspaceId: scope.target.workspaceId,
          workspaceRuntimeId: scope.target.workspaceRuntimeId,
        }),
      (snapshot) => {
        writeCanonicalWorkspacePaneTabsSnapshot(scope.target.workspaceId, scope.target.workspaceRuntimeId, snapshot)
      },
      (error) => {
        appRuntimeProjectionLog.debug('failed to refresh workspace pane tabs', {
          workspaceId: scope.target.workspaceId,
          workspaceRuntimeId: scope.target.workspaceRuntimeId,
          error,
        })
      },
    )
  }, [])

  const recoverTerminalSessionsFromServer = useCallback(
    (
      scope: RuntimeProjectionScope,
      options: { resynchronizeConnectedViews?: boolean; minimumRevision?: number } = {},
    ): void => {
      const clientId = readOrCreateWebTerminalClientId()
      terminalRecovery.request({
        scope,
        minimumRevision: options.minimumRevision ?? 0,
        refresh: options.minimumRevision === undefined,
        recover: async () => await terminalClient.recoverSessions(scope.target),
        accept: (catalog) => {
          if (!scope.isActive()) return { kind: 'inactive' }
          const localRevision = terminalProjection.terminalSessionsCatalogCoverageRevision(scope.target)
          if (localRevision !== null && localRevision > catalog.revision) {
            return { kind: 'superseded', localRevision }
          }
          const reconciled = terminalProjection.reconcileServerSessionsSnapshot(scope.target, catalog, clientId)
          if (!reconciled) {
            if (!scope.isActive()) return { kind: 'inactive' }
            const currentRevision = terminalProjection.terminalSessionsCatalogCoverageRevision(scope.target)
            if (currentRevision !== null && currentRevision > catalog.revision) {
              return { kind: 'superseded', localRevision: currentRevision }
            }
            return { kind: 'membership-rejected' }
          }
          return { kind: 'accepted' }
        },
        complete: () => {
          useTerminalProjectionHydrationStore
            .getState()
            .markProjectionReady(scope.target.workspaceId, scope.target.workspaceRuntimeId)
        },
        afterAccept: options.resynchronizeConnectedViews
          ? () =>
              terminalProjection.resynchronizeConnectedViews(scope.target.workspaceId, scope.target.workspaceRuntimeId)
          : undefined,
        reject: (error) => {
          appRuntimeProjectionLog.debug('failed to reconcile terminal sessions from server', { error })
          const hydration = useTerminalProjectionHydrationStore
            .getState()
            .hydrationByWorkspace.get(scope.target.workspaceId)
          if (hydration?.workspaceRuntimeId !== scope.target.workspaceRuntimeId || hydration.phase !== 'pending') return
          useTerminalProjectionHydrationStore
            .getState()
            .markProjectionFailed(
              scope.target.workspaceId,
              scope.target.workspaceRuntimeId,
              projectionHydrationFailureMessage(error),
            )
        },
      })
    },
    [terminalProjection, terminalRecovery],
  )

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
    scope.commit(() => {
      useTerminalProjectionHydrationStore
        .getState()
        .beginProjectionHydration(scope.target.workspaceId, scope.target.workspaceRuntimeId)
    })
    recoverTerminalSessionsFromServer(scope)

    const handleFocus = () => {
      refreshCurrentWorkspaceStatus()
      const currentScope = scopeRegistry.scopeFor(target)
      currentScope.commit(() => {
        if (!useTerminalProjectionHydrationStore.getState().shouldRefreshProjection(currentScope.target.workspaceId))
          return
        recoverTerminalSessionsFromServer(currentScope)
      })
    }
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [
    workspaceMembershipReady,
    currentWorkspaceId,
    currentWorkspaceRuntimeId,
    recoverTerminalSessionsFromServer,
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
        recoverTerminalSessionsFromServer(scope, { minimumRevision: event.revision })
      }),
    )
    let membershipRecoveryGeneration = 0
    const offRecovered = scopeRegistry.track(
      appRealtimeClient.onRecovered(() => {
        const generation = ++membershipRecoveryGeneration
        void reconcileOpenWorkspaceRuntimeMemberships(useWorkspacesStore.setState, useWorkspacesStore.getState)
          .then((recovery) => {
            if (generation !== membershipRecoveryGeneration) return
            if (recovery.kind === 'superseded') return
            scopeRegistry.disposeScopes()
            for (const target of recovery.targets) {
              if (workspaceRuntimeIdForRoot(target.workspaceId) !== target.workspaceRuntimeId) continue
              const projectionTarget = {
                workspaceId: target.workspaceId,
                workspaceRuntimeId: target.workspaceRuntimeId,
              }
              const scope = scopeRegistry.scopeFor(projectionTarget)
              scope.commit(() => {
                useTerminalProjectionHydrationStore
                  .getState()
                  .beginProjectionHydration(target.workspaceId, target.workspaceRuntimeId)
              })
              recoverTerminalSessionsFromServer(scope, { resynchronizeConnectedViews: true })
              refreshWorkspacePaneTabsForScope(scope)
            }
          })
          .catch((error) => {
            if (generation !== membershipRecoveryGeneration) return
            appRuntimeProjectionLog.warn('failed to reconcile workspace runtime memberships after realtime recovery', {
              error,
            })
          })
      }),
    )
    const offWorkspaceTabsChanged = scopeRegistry.track(
      workspacePaneTabsClient.onChanged((message) => {
        const scope = currentScopeForWorkspace(scopeRegistry, message.workspaceId)
        if (!scope) return
        if (
          message.change === 'revision' &&
          message.workspaceRuntimeId === scope.target.workspaceRuntimeId &&
          (workspacePaneTabsProjectionRevision(message.workspaceId, message.workspaceRuntimeId) ?? -1) >=
            message.revision
        ) {
          return
        }
        refreshWorkspacePaneTabsForScope(scope)
      }),
    )
    return () => {
      membershipRecoveryGeneration += 1
      offSessionsChanged()
      offRecovered()
      offWorkspaceTabsChanged()
    }
  }, [workspaceMembershipReady, recoverTerminalSessionsFromServer, refreshWorkspacePaneTabsForScope, scopeRegistry])

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

function projectionHydrationFailureMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string') return error
  return 'error.unknown'
}
