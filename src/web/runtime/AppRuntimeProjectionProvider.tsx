import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { appRealtimeClient } from '#/web/app-realtime.ts'
import { readOrCreateWebTerminalClientId } from '#/web/client-terminal-id.ts'
import { terminalClient } from '#/web/terminal.ts'
import { appRuntimeProjectionLog } from '#/web/logger.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { useTerminalProjectionHydrationStore } from '#/web/stores/terminal-projection-hydration.ts'
import { useTerminalSessionProjection } from '#/web/components/terminal/use-terminal-session-projection.ts'
import { workspacePaneTabsClient } from '#/web/workspace-pane/workspace-pane-tabs-client.ts'
import { writeCanonicalWorkspacePaneTabsSnapshot } from '#/web/workspace-pane/workspace-pane-tabs-commit.ts'
import {
  createRuntimeProjectionScopeRegistry,
  type RuntimeProjectionScope,
  type RuntimeProjectionScopeRegistry,
} from '#/web/runtime/runtime-projection-scope.ts'
import { reconcileOpenRepoRuntimeMemberships } from '#/web/stores/repos/repo-session-write-paths.ts'

interface AppRuntimeProjectionProviderProps {
  children: ReactNode
  currentRepoId: string | null
}

const TERMINAL_RECOVERY_LANE = 'terminal-recovery'
const TERMINAL_SESSIONS_CHANGED_TIMER_LANE = 'terminal-sessions-changed'
const WORKSPACE_TABS_REFRESH_LANE = 'workspace-tabs-refresh'

export function AppRuntimeProjectionProvider({ children, currentRepoId }: AppRuntimeProjectionProviderProps) {
  const currentRepoRuntimeId = useReposStore((s) =>
    currentRepoId ? (s.repos[currentRepoId]?.repoRuntimeId ?? null) : null,
  )
  const workspaceMembershipReady = useReposStore((s) => s.workspaceMembershipReady)
  const terminalProjection = useTerminalSessionProjection()
  const [scopeRegistry] = useState(() =>
    createRuntimeProjectionScopeRegistry(
      (target) =>
        useReposStore.getState().workspaceMembershipReady &&
        repoRuntimeIdForRoot(target.repoRoot) === target.repoRuntimeId,
    ),
  )

  const refreshWorkspacePaneTabsForScope = useCallback((scope: RuntimeProjectionScope): void => {
    scope.runLatest(
      WORKSPACE_TABS_REFRESH_LANE,
      async () =>
        await workspacePaneTabsClient.list({
          workspaceId: scope.target.repoRoot,
          workspaceRuntimeId: scope.target.repoRuntimeId,
        }),
      (snapshot) => {
        writeCanonicalWorkspacePaneTabsSnapshot(scope.target.repoRoot, scope.target.repoRuntimeId, snapshot)
      },
      (error) => {
        appRuntimeProjectionLog.debug('failed to refresh workspace pane tabs', {
          repoRoot: scope.target.repoRoot,
          repoRuntimeId: scope.target.repoRuntimeId,
          error,
        })
      },
    )
  }, [])

  const recoverTerminalSessionsFromServer = useCallback(
    (scope: RuntimeProjectionScope, options: { resynchronizeConnectedViews?: boolean } = {}): void => {
      scope.runLatest(
        TERMINAL_RECOVERY_LANE,
        async () => ({
          clientId: readOrCreateWebTerminalClientId(),
          catalog: await terminalClient.recoverSessions(scope.target),
        }),
        ({ clientId, catalog }) => {
          const reconciled = terminalProjection.reconcileServerSessionsSnapshot(
            scope.target,
            catalog,
            clientId,
          )
          if (!reconciled) return
          if (options.resynchronizeConnectedViews) {
            terminalProjection.resynchronizeConnectedViews(scope.target.repoRoot, scope.target.repoRuntimeId)
          }
          useTerminalProjectionHydrationStore
            .getState()
            .markProjectionReady(scope.target.repoRoot, scope.target.repoRuntimeId)
        },
        (error) => {
          appRuntimeProjectionLog.debug('failed to reconcile terminal sessions from server', { error })
          const hydration = useTerminalProjectionHydrationStore.getState().hydrationByRepo.get(scope.target.repoRoot)
          if (hydration?.repoRuntimeId !== scope.target.repoRuntimeId || hydration.phase !== 'pending') return
          useTerminalProjectionHydrationStore
            .getState()
            .markProjectionFailed(
              scope.target.repoRoot,
              scope.target.repoRuntimeId,
              projectionHydrationFailureMessage(error),
            )
        },
      )
    },
    [terminalProjection],
  )

  useEffect(() => () => scopeRegistry.disposeScopes(), [scopeRegistry])

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') appRealtimeClient.kickReconnect()
    }
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) appRealtimeClient.kickReconnect()
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
  }, [scopeRegistry])

  useEffect(() => {
    if (!workspaceMembershipReady || !currentRepoId || !currentRepoRuntimeId) return
    const target = { repoRoot: currentRepoId, repoRuntimeId: currentRepoRuntimeId }
    const scope = scopeRegistry.scopeFor(target)
    scope.commit(() => {
      useTerminalProjectionHydrationStore
        .getState()
        .beginProjectionHydration(scope.target.repoRoot, scope.target.repoRuntimeId)
    })
    recoverTerminalSessionsFromServer(scope)

    const handleFocus = () => {
      const currentScope = scopeRegistry.scopeFor(target)
      currentScope.commit(() => {
        if (!useTerminalProjectionHydrationStore.getState().shouldRefreshProjection(currentScope.target.repoRoot))
          return
        recoverTerminalSessionsFromServer(currentScope)
      })
    }
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [workspaceMembershipReady, currentRepoId, currentRepoRuntimeId, recoverTerminalSessionsFromServer, scopeRegistry])

  useEffect(() => {
    if (!workspaceMembershipReady) {
      scopeRegistry.disposeScopes()
      return
    }
    const offSessionsChanged = scopeRegistry.track(
      terminalClient.onSessionsChanged((repoRoot) => {
        const scope = currentScopeForRepo(scopeRegistry, repoRoot)
        if (!scope) return
        scope.setTimer(TERMINAL_SESSIONS_CHANGED_TIMER_LANE, () => recoverTerminalSessionsFromServer(scope), 0)
      }),
    )
    let membershipRecoveryGeneration = 0
    const offRecovered = scopeRegistry.track(
      appRealtimeClient.onRecovered(() => {
        const generation = ++membershipRecoveryGeneration
        void reconcileOpenRepoRuntimeMemberships(useReposStore.setState, useReposStore.getState)
          .then((recovery) => {
            if (generation !== membershipRecoveryGeneration) return
            if (recovery.kind === 'superseded') return
            scopeRegistry.disposeScopes()
            for (const target of recovery.targets) {
              if (repoRuntimeIdForRoot(target.repoRoot) !== target.repoRuntimeId) continue
              const scope = scopeRegistry.scopeFor(target)
              scope.commit(() => {
                useTerminalProjectionHydrationStore
                  .getState()
                  .beginProjectionHydration(target.repoRoot, target.repoRuntimeId)
              })
              recoverTerminalSessionsFromServer(scope, { resynchronizeConnectedViews: true })
              refreshWorkspacePaneTabsForScope(scope)
            }
          })
          .catch((error) => {
            if (generation !== membershipRecoveryGeneration) return
            appRuntimeProjectionLog.warn('failed to reconcile repo runtime memberships after realtime recovery', {
              error,
            })
          })
      }),
    )
    const offWorkspaceTabsChanged = scopeRegistry.track(
      workspacePaneTabsClient.onChanged((repoRoot) => {
        const scope = currentScopeForRepo(scopeRegistry, repoRoot)
        if (scope) refreshWorkspacePaneTabsForScope(scope)
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

function currentScopeForRepo(
  registry: RuntimeProjectionScopeRegistry,
  repoRoot: string,
): RuntimeProjectionScope | null {
  const repoRuntimeId = repoRuntimeIdForRoot(repoRoot)
  return repoRuntimeId ? registry.scopeFor({ repoRoot, repoRuntimeId }) : null
}

function repoRuntimeIdForRoot(repoRoot: string): string | null {
  return useReposStore.getState().repos[repoRoot]?.repoRuntimeId ?? null
}

function projectionHydrationFailureMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string') return error
  return 'error.unknown'
}
