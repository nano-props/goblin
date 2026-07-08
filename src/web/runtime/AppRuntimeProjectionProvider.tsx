import { useCallback, useEffect, type ReactNode } from 'react'
import { appRealtimeClient } from '#/web/app-realtime.ts'
import { readOrCreateWebTerminalClientId } from '#/web/client-terminal-id.ts'
import { terminalClient } from '#/web/terminal.ts'
import { appRuntimeProjectionLog } from '#/web/logger.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { useTerminalProjectionHydrationStore } from '#/web/stores/terminal-projection-hydration.ts'
import { useTerminalSessionProjection } from '#/web/components/terminal/use-terminal-session-projection.ts'
import { refreshWorkspacePaneTabs } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { workspacePaneTabsClient } from '#/web/workspace-pane/workspace-pane-tabs-client.ts'
import type { TerminalHydrationSnapshot } from '#/shared/terminal-types.ts'

interface AppRuntimeProjectionProviderProps {
  children: ReactNode
  currentRepoId: string | null
}

export function AppRuntimeProjectionProvider({ children, currentRepoId }: AppRuntimeProjectionProviderProps) {
  const currentRepoRuntimeId = useReposStore((s) =>
    currentRepoId ? (s.repos[currentRepoId]?.repoRuntimeId ?? null) : null,
  )
  const workspaceMembershipReady = useReposStore((s) => s.workspaceMembershipReady)
  const terminalProjection = useTerminalSessionProjection()

  const recoverTerminalSessionsFromServer = useCallback(
    async (
      repoRoot: string,
      expectedRepoRuntimeId?: string,
      options?: { markInitialHydrationFailure?: boolean },
    ): Promise<void> => {
      const repoRuntimeId = repoRuntimeIdForRoot(repoRoot)
      if (!repoRoot || !repoRuntimeId) return
      if (expectedRepoRuntimeId && repoRuntimeId !== expectedRepoRuntimeId) return
      try {
        const clientId = readOrCreateWebTerminalClientId()
        const recovery = await terminalClient.recoverSessions({ repoRoot, repoRuntimeId })
        if (repoRuntimeIdForRoot(repoRoot) !== repoRuntimeId) return
        const reconciled = terminalProjection.reconcileServerSessions(
          { repoRoot, repoRuntimeId },
          recovery.sessions,
          clientId,
          terminalHydrationSnapshotMap(recovery.snapshots),
        )
        if (!reconciled) return
        useTerminalProjectionHydrationStore.getState().markProjectionReady(repoRoot, repoRuntimeId)
      } catch (err) {
        appRuntimeProjectionLog.debug('failed to reconcile terminal sessions from server', { err })
        if (options?.markInitialHydrationFailure && repoRuntimeIdForRoot(repoRoot) === repoRuntimeId) {
          useTerminalProjectionHydrationStore
            .getState()
            .markProjectionFailed(repoRoot, repoRuntimeId, projectionHydrationFailureMessage(err))
        }
      }
    },
    [terminalProjection],
  )

  const recoverKnownServerState = useCallback(() => {
    for (const repo of currentRepoRuntimes()) {
      void recoverTerminalSessionsFromServer(repo.repoRoot, repo.repoRuntimeId)
      refreshWorkspacePaneTabs(repo.repoRoot, repo.repoRuntimeId)
    }
  }, [recoverTerminalSessionsFromServer])

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return
      appRealtimeClient.kickReconnect()
    }
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return
      appRealtimeClient.kickReconnect()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('pageshow', onPageShow)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pageshow', onPageShow)
    }
  }, [])

  useEffect(() => {
    if (!workspaceMembershipReady || !currentRepoId || !currentRepoRuntimeId) return
    const repoRoot = currentRepoId
    const repoRuntimeId = currentRepoRuntimeId
    let disposed = false
    useTerminalProjectionHydrationStore.getState().beginProjectionHydration(repoRoot, repoRuntimeId)
    void recoverTerminalSessionsFromServer(repoRoot, repoRuntimeId, { markInitialHydrationFailure: true })

    const handleFocus = () => {
      if (!currentRepoId) return
      if (!useTerminalProjectionHydrationStore.getState().shouldRefreshProjection(currentRepoId)) return
      void recoverTerminalSessionsFromServer(currentRepoId)
    }
    window.addEventListener('focus', handleFocus)

    const pendingProjectionRefreshRepoRoots = new Set<string>()
    let refreshTimer: number | null = null
    const scheduleProjectionRefresh = (repoRoot: string) => {
      pendingProjectionRefreshRepoRoots.add(repoRoot)
      if (refreshTimer !== null) return
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null
        if (disposed) return
        const repoRoots = Array.from(pendingProjectionRefreshRepoRoots)
        pendingProjectionRefreshRepoRoots.clear()
        for (const nextRepoRoot of repoRoots) void recoverTerminalSessionsFromServer(nextRepoRoot)
      }, 0)
    }
    const offSessionsChanged = terminalClient.onSessionsChanged(scheduleProjectionRefresh)
    const offRecovered = appRealtimeClient.onRecovered(() => {
      if (disposed) return
      recoverKnownServerState()
    })
    const offWorkspaceTabsChanged = workspacePaneTabsClient.onChanged((repoRoot) => {
      const repoRuntimeId = repoRuntimeIdForRoot(repoRoot)
      if (typeof repoRuntimeId === 'string') refreshWorkspacePaneTabs(repoRoot, repoRuntimeId)
    })

    return () => {
      disposed = true
      if (refreshTimer !== null) window.clearTimeout(refreshTimer)
      window.removeEventListener('focus', handleFocus)
      offSessionsChanged()
      offRecovered()
      offWorkspaceTabsChanged()
    }
  }, [
    workspaceMembershipReady,
    currentRepoId,
    currentRepoRuntimeId,
    recoverTerminalSessionsFromServer,
    recoverKnownServerState,
  ])

  return <>{children}</>
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

function projectionHydrationFailureMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message
  if (typeof err === 'string') return err
  return 'error.unknown'
}
