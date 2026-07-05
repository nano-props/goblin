import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react'

import '#/web/components/terminal/terminal-session.css'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { useRepoSyncStore } from '#/web/stores/repo-sync.ts'
import { terminalClient } from '#/web/terminal.ts'
import { terminalSessionProviderLog } from '#/web/logger.ts'
import {
  TerminalSessionContext,
  TerminalSessionReadContext,
} from '#/web/components/terminal/terminal-session-context.ts'
import { readOrCreateWebTerminalClientId } from '#/web/client-terminal-id.ts'
import { preloadTerminalFont } from '#/web/components/terminal/terminal-geometry.ts'
import { loadTerminalSessions } from '#/web/terminal-session-queries.ts'
import {
  refreshWorkspacePaneTabs,
  setWorkspacePaneTabsForTargetQueryData,
} from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import {
  TerminalSessionProjection,
  getTerminalSessionProjection,
} from '#/web/components/terminal/TerminalSessionProjection.ts'
import { setTerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import { useTerminalRepoIndex } from '#/web/components/terminal/terminal-repo-index.ts'
import type { TerminalSessionContextValue, TerminalSessionReadContextValue } from '#/web/components/terminal/types.ts'

interface TerminalSessionProviderProps {
  children: ReactNode
  currentRepoId: string | null
}

export function TerminalSessionProvider({ children, currentRepoId }: TerminalSessionProviderProps) {
  const repoIndex = useTerminalRepoIndex()
  const currentRepoInstanceId = currentRepoId ? (repoIndex[currentRepoId]?.instanceId ?? null) : null
  const selectedTerminalSessionIdByTerminalWorktree = useReposStore(
    (s) => s.selectedTerminalSessionIdByTerminalWorktree,
  )
  const setSelectedTerminal = useReposStore((s) => s.setSelectedTerminal)
  const repoIndexRef = useRef(repoIndex)
  repoIndexRef.current = repoIndex

  // T1.1: prewarm the terminal font at app startup. The provider lives at
  // the router root above the per-route App, so this fires once per app
  // run (no `key` prop on the provider). preloadTerminalFont is
  // idempotent — `document.fonts.check` short-circuits on the second
  // call when openPhase's own preload fires. Failure is swallowed
  // inside the function; we don't surface it.
  useEffect(() => {
    void preloadTerminalFont()
  }, [])

  // T1.2: pay the WebSocket handshake cost when the user enters a repo,
  // before they click a terminal view. The client maintains a single
  // shared socket, so watching currentRepoId (not terminalWorktreeKey)
  // is the right granularity: one handshake per repo visit, not one per
  // worktree tab. The prewarm is fire-and-forget — failures are
  // swallowed inside the client; the next real IPC will surface a real
  // error if the server is unreachable.
  useEffect(() => {
    if (!currentRepoId) return
    void terminalClient.prewarm()
  }, [currentRepoId])

  // The projection is a client-level singleton (terminal-roadmap.md P1.7).
  // The first Provider mount constructs it via `getTerminalSessionProjection`;
  // subsequent mounts (StrictMode re-mount, route round-trip) reuse the
  // same instance. The ref is kept only so the rest of this component can
  // reach the singleton without re-calling the getter on every render.
  const projectionRef = useRef<TerminalSessionProjection | null>(null)
  if (!projectionRef.current) {
    projectionRef.current = getTerminalSessionProjection({
      onSelectedWorktreeChange: setSelectedTerminal,
      onWorkspaceTabsChanged: (base, tabs) => {
        if (typeof base.repoInstanceId !== 'string') return
        setWorkspacePaneTabsForTargetQueryData({
          repoRoot: base.repoRoot,
          repoInstanceId: base.repoInstanceId,
          branchName: base.branch,
          worktreePath: base.worktreePath,
          tabs,
        })
      },
    })
  }
  const projection = projectionRef.current

  const reconcileTerminalSessionsFromServer = useCallback(
    async (repoRoot: string) => {
      const repo = repoIndexRef.current[repoRoot]
      if (!repoRoot || !repo) return
      try {
        const clientId = readOrCreateWebTerminalClientId()
        const serverSessions = await loadTerminalSessions(repoRoot, repo.instanceId)
        if (repoIndexRef.current[repoRoot]?.instanceId !== repo.instanceId) return
        projection.reconcileServerSessions(repoRoot, serverSessions, clientId)
        useRepoSyncStore.getState().markReady(repoRoot, repo.instanceId)
      } catch (err) {
        terminalSessionProviderLog.debug('failed to reconcile terminal sessions from server', { err })
      }
    },
    [projection],
  )

  // Projection state sync
  useEffect(() => {
    projection.setRepoIndex(repoIndex)
    projection.setPreferredSelectedTerminalSessionIds(selectedTerminalSessionIdByTerminalWorktree)
  }, [projection, repoIndex, selectedTerminalSessionIdByTerminalWorktree])

  // T5.1: visibility recovery hook. On `visibilitychange:visible` and
  // on `pageshow` (bfcache restore on Safari/Firefox mobile), call
  // `kickReconnect()` so a backgrounded tab reconnects without
  // waiting for the 300ms backoff. The kick is a no-op if the socket
  // is already healthy, so it costs nothing on a desktop browser
  // where the WS rarely drops. No periodic polling, no force-close
  // of a working socket. State updates flow through the existing
  // server-push `sessions-changed` event after the (re)opened
  // socket delivers its initial snapshot — we never trigger a
  // client-side reconcile here.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return
      terminalClient.kickReconnect()
    }
    const onPageShow = (event: PageTransitionEvent) => {
      // `event.persisted === true` means the page came from the
      // bfcache (Safari/Firefox mobile). A non-persisted pageshow
      // is a regular full load and the client is already healthy.
      if (!event.persisted) return
      terminalClient.kickReconnect()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('pageshow', onPageShow)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pageshow', onPageShow)
    }
  }, [])

  // Projection event wiring (singleton lifecycle, see terminal-roadmap.md P1.7).
  // The projection is client-level; we only subscribe / unsubscribe client
  // events on mount/unmount. We do NOT destroy the projection — the singleton
  // outlives the Provider. StrictMode re-mounts simply re-register the same
  // listeners against the same instance.
  useEffect(() => {
    const offOutput = terminalClient.onOutput((event) => {
      projection.handleOutput(event)
    })
    const offBell = terminalClient.onBell((event) => {
      projection.handleServerBell(event)
    })
    const offTitle = terminalClient.onTitle((event) => {
      projection.handleServerTitle(event)
    })
    const offExit = terminalClient.onExit((event) => {
      projection.handleExit(event)
    })
    const offIdentity = terminalClient.onIdentity((event) => {
      projection.handleIdentity(event)
    })
    const offLifecycle = terminalClient.onLifecycle((event) => {
      projection.handleLifecycle(event)
    })
    // Per-session close broadcast. When the server confirms a close,
    // drop the matching local entry immediately so a sibling window
    // (or a stale local entry from a lost close in the current
    // window) doesn't reattach to the orphan. The originating window
    // already disposed the local entry, so the handler is a no-op
    // there — the broadcast is multi-window safe by construction.
    const offSessionClosed = terminalClient.onSessionClosed((event) => {
      projection.handleSessionClosed(event)
      const repoInstanceId = repoIndexRef.current[event.repoRoot]?.instanceId
      if (typeof repoInstanceId === 'string') refreshWorkspacePaneTabs(event.repoRoot, repoInstanceId)
    })

    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: projection.terminalWorktreeSnapshot,
      createTerminal: projection.createTerminal,
      selectTerminal: projection.selectTerminal,
      closeTerminalByDescriptor: projection.closeTerminalByDescriptor,
      closeTerminalsForWorktree: projection.closeTerminalsForWorktree,
    })

    return () => {
      offOutput()
      offBell()
      offTitle()
      offExit()
      offIdentity()
      offLifecycle()
      offSessionClosed()
    }
  }, [projection])

  // Terminal sessions are runtime state owned by the server. Keep the client
  // projection reconciled on route entry, focus recovery, and server-pushed
  // terminal session changes without feeding back into repo routing/read models.
  useEffect(() => {
    if (!currentRepoId) return
    const repoRoot = currentRepoId
    void reconcileTerminalSessionsFromServer(repoRoot)

    const handleFocus = () => {
      if (!currentRepoId) return
      if (!useRepoSyncStore.getState().shouldSync(currentRepoId)) return
      void reconcileTerminalSessionsFromServer(currentRepoId)
    }
    window.addEventListener('focus', handleFocus)

    const pendingRepoRoots = new Set<string>()
    let syncTimer: number | null = null
    let disposed = false
    const scheduleServerSync = (repoRoot: string) => {
      pendingRepoRoots.add(repoRoot)
      if (syncTimer !== null) return
      syncTimer = window.setTimeout(() => {
        syncTimer = null
        if (disposed) return
        const repoRoots = Array.from(pendingRepoRoots)
        pendingRepoRoots.clear()
        for (const nextRepoRoot of repoRoots) void reconcileTerminalSessionsFromServer(nextRepoRoot)
      }, 0)
    }
    const offSessionsChanged = terminalClient.onSessionsChanged(scheduleServerSync)
    const offWorkspaceTabsChanged = terminalClient.onWorkspaceTabsChanged((repoRoot) => {
      const repoInstanceId = repoIndexRef.current[repoRoot]?.instanceId
      if (typeof repoInstanceId === 'string') refreshWorkspacePaneTabs(repoRoot, repoInstanceId)
      scheduleServerSync(repoRoot)
    })

    return () => {
      disposed = true
      if (syncTimer !== null) window.clearTimeout(syncTimer)
      window.removeEventListener('focus', handleFocus)
      offSessionsChanged()
      offWorkspaceTabsChanged()
    }
  }, [currentRepoId, currentRepoInstanceId, reconcileTerminalSessionsFromServer])

  const commandValue = useMemo<TerminalSessionContextValue>(
    () => ({
      createTerminal: projection.createTerminal,
      createOwnedTerminal: projection.createOwnedTerminal,
      registerHost: projection.registerHost,
      unregisterHost: projection.unregisterHost,
      selectTerminal: projection.selectTerminal,
      scrollToBottom: projection.scrollToBottom,
      scrollLines: projection.scrollLines,
      clearBell: projection.clearBell,
      closeTerminalByDescriptor: projection.closeTerminalByDescriptor,
      attach: projection.attach,
      detach: projection.detach,
      restart: projection.restart,
      focusTerminal: projection.focusTerminal,
      isTerminalFocusTarget: projection.isTerminalFocusTarget,
      findNext: projection.findNext,
      findPrevious: projection.findPrevious,
      clearSearch: projection.clearSearch,
      writeInput: projection.writeInput,
      takeover: projection.takeover,
    }),
    [projection],
  )
  const readValue = useMemo<TerminalSessionReadContextValue>(
    () => ({
      terminalWorktreeSnapshot: projection.terminalWorktreeSnapshot,
      subscribeTerminalWorktree: projection.subscribeTerminalWorktree,
      repoBellCount: projection.repoBellCount,
      subscribeRepoBellCount: projection.subscribeRepoBellCount,
      snapshot: projection.snapshot,
      subscribeSnapshot: projection.subscribeSnapshot,
    }),
    [projection],
  )

  return (
    <TerminalSessionContext value={commandValue}>
      <TerminalSessionReadContext value={readValue}>{children}</TerminalSessionReadContext>
    </TerminalSessionContext>
  )
}
