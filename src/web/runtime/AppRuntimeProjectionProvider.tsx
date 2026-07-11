import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { appRealtimeClient } from '#/web/app-realtime.ts'
import { readOrCreateWebTerminalClientId } from '#/web/client-terminal-id.ts'
import { terminalClient } from '#/web/terminal.ts'
import { appRuntimeProjectionLog } from '#/web/logger.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { useTerminalProjectionHydrationStore } from '#/web/stores/terminal-projection-hydration.ts'
import { useTerminalSessionProjection } from '#/web/components/terminal/use-terminal-session-projection.ts'
import { workspacePaneTabsClient } from '#/web/workspace-pane/workspace-pane-tabs-client.ts'
import type { TerminalHydrationSnapshot } from '#/shared/terminal-types.ts'
import { writeCanonicalWorkspacePaneTabsSnapshot } from '#/web/workspace-pane/workspace-pane-tabs-commit.ts'
import {
  createRuntimeProjectionScopeRegistry,
  type RuntimeProjectionScope,
  type RuntimeProjectionScopeRegistry,
} from '#/web/runtime/runtime-projection-scope.ts'

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
      async () => await workspacePaneTabsClient.list(scope.target),
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
    (scope: RuntimeProjectionScope): void => {
      scope.runLatest(
        TERMINAL_RECOVERY_LANE,
        async () => ({
          clientId: readOrCreateWebTerminalClientId(),
          recovery: await terminalClient.recoverSessions(scope.target),
        }),
        ({ clientId, recovery }) => {
          try {
            writeCanonicalWorkspacePaneTabsSnapshot(
              scope.target.repoRoot,
              scope.target.repoRuntimeId,
              recovery.workspacePaneTabs,
            )
          } catch (error) {
            appRuntimeProjectionLog.debug('failed to apply workspace pane tabs from terminal recovery', { error })
            refreshWorkspacePaneTabsForScope(scope)
          }
          const reconciled = terminalProjection.reconcileServerSessionsSnapshot(
            scope.target,
            recovery.terminalSessions,
            clientId,
            terminalHydrationSnapshotMap(recovery.snapshots),
          )
          if (!reconciled) return
          useTerminalProjectionHydrationStore
            .getState()
            .markProjectionReady(scope.target.repoRoot, scope.target.repoRuntimeId)
        },
        (error) => {
          appRuntimeProjectionLog.debug('failed to reconcile terminal sessions from server', { error })
          const hydration = useTerminalProjectionHydrationStore
            .getState()
            .hydrationByRepo.get(scope.target.repoRoot)
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
    [refreshWorkspacePaneTabsForScope, terminalProjection],
  )

  useEffect(() => () => scopeRegistry.dispose(), [scopeRegistry])

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') appRealtimeClient.kickReconnect()
    }
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) appRealtimeClient.kickReconnect()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('pageshow', onPageShow)
    const offVisibility = scopeRegistry.track(() => document.removeEventListener('visibilitychange', onVisibilityChange))
    const offPageShow = scopeRegistry.track(() => window.removeEventListener('pageshow', onPageShow))
    return () => {
      offVisibility()
      offPageShow()
    }
  }, [scopeRegistry])

  useEffect(() => {
    if (!workspaceMembershipReady || !currentRepoId || !currentRepoRuntimeId) return
    const scope = scopeRegistry.scopeFor({ repoRoot: currentRepoId, repoRuntimeId: currentRepoRuntimeId })
    scope.commit(() => {
      useTerminalProjectionHydrationStore
        .getState()
        .beginProjectionHydration(scope.target.repoRoot, scope.target.repoRuntimeId)
    })
    recoverTerminalSessionsFromServer(scope)

    const handleFocus = () => {
      scope.commit(() => {
        if (!useTerminalProjectionHydrationStore.getState().shouldRefreshProjection(scope.target.repoRoot)) return
        recoverTerminalSessionsFromServer(scope)
      })
    }
    window.addEventListener('focus', handleFocus)
    return scope.track(() => window.removeEventListener('focus', handleFocus))
  }, [
    workspaceMembershipReady,
    currentRepoId,
    currentRepoRuntimeId,
    recoverTerminalSessionsFromServer,
    scopeRegistry,
  ])

  useEffect(() => {
    if (!workspaceMembershipReady) {
      scopeRegistry.disposeScopes()
      return
    }
    const offSessionsChanged = scopeRegistry.track(
      terminalClient.onSessionsChanged((repoRoot) => {
        const scope = currentScopeForRepo(scopeRegistry, repoRoot)
        if (!scope) return
        scope.setTimer(
          TERMINAL_SESSIONS_CHANGED_TIMER_LANE,
          () => recoverTerminalSessionsFromServer(scope),
          0,
        )
      }),
    )
    const offRecovered = scopeRegistry.track(
      appRealtimeClient.onRecovered(() => {
        for (const target of currentRepoRuntimes()) {
          const scope = scopeRegistry.scopeFor(target)
          recoverTerminalSessionsFromServer(scope)
          refreshWorkspacePaneTabsForScope(scope)
        }
      }),
    )
    const offWorkspaceTabsChanged = scopeRegistry.track(
      workspacePaneTabsClient.onChanged((repoRoot) => {
        const scope = currentScopeForRepo(scopeRegistry, repoRoot)
        if (scope) refreshWorkspacePaneTabsForScope(scope)
      }),
    )
    return () => {
      offSessionsChanged()
      offRecovered()
      offWorkspaceTabsChanged()
    }
  }, [
    workspaceMembershipReady,
    recoverTerminalSessionsFromServer,
    refreshWorkspacePaneTabsForScope,
    scopeRegistry,
  ])

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

function currentRepoRuntimes(): Array<{ repoRoot: string; repoRuntimeId: string }> {
  return Object.values(useReposStore.getState().repos).map((repo) => ({
    repoRoot: repo.id,
    repoRuntimeId: repo.repoRuntimeId,
  }))
}

function terminalHydrationSnapshotMap(
  snapshots: readonly TerminalHydrationSnapshot[],
): Map<string, TerminalHydrationSnapshot> {
  return new Map(snapshots.map((snapshot) => [snapshot.terminalRuntimeSessionId, snapshot]))
}

function projectionHydrationFailureMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string') return error
  return 'error.unknown'
}
