import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useStoreWithEqualityFn } from 'zustand/traditional'

import type {
  TerminalSessionSnapshot,
  TerminalSessionSummary,
  TerminalWorkspaceTabsEntry,
} from '#/shared/terminal-types.ts'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import '#/web/components/terminal/terminal-session.css'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { useRepoSyncStore } from '#/web/stores/repo-sync.ts'
import { terminalBridge } from '#/web/terminal.ts'
import { terminalSessionProviderLog } from '#/web/logger.ts'
import {
  TerminalSessionContext,
  TerminalSessionReadContext,
} from '#/web/components/terminal/terminal-session-context.ts'
import { readOrCreateWebTerminalClientId } from '#/web/client-terminal-id.ts'
import { preloadTerminalFont } from '#/web/components/terminal/terminal-geometry.ts'
import { loadTerminalSessions } from '#/web/terminal-session-queries.ts'
import {
  TerminalSessionProjection,
  getTerminalSessionProjection,
} from '#/web/components/terminal/TerminalSessionProjection.ts'
import { setTerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import { repoIndexEqual, repoIndexFromRepos } from '#/web/components/terminal/terminal-repo-index.ts'
import type { TerminalSessionContextValue, TerminalSessionReadContextValue } from '#/web/components/terminal/types.ts'

interface TerminalSessionProviderProps {
  children: ReactNode
}

export function TerminalSessionProvider({ children }: TerminalSessionProviderProps) {
  const repoIndex = useStoreWithEqualityFn(useReposStore, (s) => repoIndexFromRepos(s.repos), repoIndexEqual)
  // The provider lives at the router root (above the per-route App), so it
  // reads the active repo directly from the repos store rather than via a
  // prop. This keeps the terminal session projection, parking root, and
  // xterm views alive across settings → workspace round-trips.
  const currentRepoId = useReposStore((s) => s.activeId)
  const currentRepoInstanceToken = currentRepoId ? (repoIndex[currentRepoId]?.instanceToken ?? null) : null
  const selectedTerminalSessionIdByTerminalWorktree = useReposStore(
    (s) => s.selectedTerminalSessionIdByTerminalWorktree,
  )
  const setSelectedTerminal = useReposStore((s) => s.setSelectedTerminal)
  const parkingRootRef = useRef<HTMLDivElement | null>(null)
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
  // before they click a terminal view. The bridge maintains a single
  // shared socket, so watching currentRepoId (not terminalWorktreeKey)
  // is the right granularity: one handshake per repo visit, not one per
  // worktree tab. The prewarm is fire-and-forget — failures are
  // swallowed inside the bridge; the next real IPC will surface a real
  // error if the server is unreachable.
  useEffect(() => {
    if (!currentRepoId) return
    void terminalBridge.prewarm()
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
        useReposStore.getState().replaceWorkspacePaneTabs(base.repoRoot, [...tabs], base.branch)
      },
    })
  }
  const projection = projectionRef.current

  const loadMissingSnapshots = useCallback(
    async (serverSessions: TerminalSessionSummary[]): Promise<Map<string, TerminalSessionSnapshot>> => {
      // allSettled (not all) so a single rejected snapshot fetch does not
      // cancel the rest of the reconciliation. Each request is bounded by
      // the bridge's per-request timeout, so the worst case here is that
      // one slow session delays the final map by that timeout — but every
      // other session's snapshot is delivered to the caller regardless.
      // Rejections are surfaced via `result.reason` so they remain visible
      // in logs without poisoning the reconciliation.
      const settled = await Promise.allSettled(
        serverSessions.map((session) => terminalBridge.getSessionSnapshot({ ptySessionId: session.ptySessionId })),
      )
      const entries: Array<readonly [string, TerminalSessionSnapshot]> = []
      settled.forEach((result, index) => {
        const session = serverSessions[index]
        if (!session) return
        if (result.status === 'fulfilled') {
          const snapshot = result.value
          if (snapshot) entries.push([session.ptySessionId, snapshot])
          return
        }
        terminalSessionProviderLog.debug('failed to load terminal session snapshot', {
          ptySessionId: session.ptySessionId,
          err: result.reason,
        })
      })
      return new Map(entries)
    },
    [projection],
  )

  const syncServerSessions = useCallback(
    async (repoRoot: string) => {
      if (!repoRoot || !repoIndexRef.current[repoRoot]) return
      try {
        const clientId = readOrCreateWebTerminalClientId()
        const [serverSessions, workspaceTabs] = await Promise.all([
          loadTerminalSessions(repoRoot),
          terminalBridge.listWorkspaceTabs({ repoRoot }),
        ])
        const snapshotsByPtySessionId = await loadMissingSnapshots(serverSessions)
        if (!repoIndexRef.current[repoRoot]) return
        applyWorkspaceTabsForRepo(repoRoot, workspaceTabs, repoIndexRef.current)
        projection.reconcileServerSessions(repoRoot, serverSessions, clientId, snapshotsByPtySessionId)
      } catch (err) {
        terminalSessionProviderLog.debug('failed to sync server sessions', { err })
      } finally {
        const instanceToken = repoIndexRef.current[repoRoot]?.instanceToken
        if (typeof instanceToken === 'number') {
          useRepoSyncStore.getState().markReady(repoRoot, instanceToken)
        }
      }
    },
    [loadMissingSnapshots, projection],
  )

  // Projection state sync
  useEffect(() => {
    projection.setRepoIndex(repoIndex)
    projection.setPreferredSelectedTerminalSessionIds(selectedTerminalSessionIdByTerminalWorktree)
  }, [projection, repoIndex, selectedTerminalSessionIdByTerminalWorktree])

  // Parking DOM
  useEffect(() => {
    projection.setParkingRoot(parkingRootRef.current)
  })

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
      terminalBridge.kickReconnect()
    }
    const onPageShow = (event: PageTransitionEvent) => {
      // `event.persisted === true` means the page came from the
      // bfcache (Safari/Firefox mobile). A non-persisted pageshow
      // is a regular full load and the bridge is already healthy.
      if (!event.persisted) return
      terminalBridge.kickReconnect()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('pageshow', onPageShow)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pageshow', onPageShow)
    }
  }, [])

  // Projection event wiring (singleton lifecycle, see terminal-roadmap.md P1.7).
  // The projection is client-level; we only subscribe / unsubscribe bridge
  // events on mount/unmount. We do NOT destroy the projection — the singleton
  // outlives the Provider. StrictMode re-mounts simply re-register the same
  // listeners against the same instance.
  useEffect(() => {
    const offOutput = terminalBridge.onOutput((event) => {
      projection.handleOutput(event)
    })
    const offTitle = terminalBridge.onTitle((event) => {
      projection.handleServerTitle(event)
    })
    const offExit = terminalBridge.onExit((event) => {
      projection.handleExit(event)
    })
    const offIdentity = terminalBridge.onIdentity((event) => {
      projection.handleIdentity(event)
    })
    const offLifecycle = terminalBridge.onLifecycle((event) => {
      projection.handleLifecycle(event)
    })
    // Per-session close broadcast. When the server confirms a close,
    // drop the matching local entry immediately so a sibling window
    // (or a stale local entry from a lost close in the current
    // window) doesn't reattach to the orphan. The originating window
    // already disposed the local entry, so the handler is a no-op
    // there — the broadcast is multi-window safe by construction.
    const offSessionClosed = terminalBridge.onSessionClosed((event) => {
      projection.handleSessionClosed(event.ptySessionId)
      applyWorkspaceTabsForWorktree(event.repoRoot, event.worktreePath, event.tabs, repoIndexRef.current)
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
      offTitle()
      offExit()
      offIdentity()
      offLifecycle()
      offSessionClosed()
    }
  }, [projection])

  // Server sync (initial + focus + external session changes)
  useEffect(() => {
    if (!currentRepoId) return
    const repoRoot = currentRepoId
    void syncServerSessions(repoRoot)

    const handleFocus = () => {
      const focusedRepoRoot = useReposStore.getState().activeId
      if (!focusedRepoRoot) return
      if (!useRepoSyncStore.getState().shouldSync(focusedRepoRoot)) return
      void syncServerSessions(focusedRepoRoot)
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
        for (const nextRepoRoot of repoRoots) void syncServerSessions(nextRepoRoot)
      }, 0)
    }
    const offSessionsChanged = terminalBridge.onSessionsChanged(scheduleServerSync)
    const offWorkspaceTabsChanged = terminalBridge.onWorkspaceTabsChanged(scheduleServerSync)

    return () => {
      disposed = true
      if (syncTimer !== null) window.clearTimeout(syncTimer)
      window.removeEventListener('focus', handleFocus)
      offSessionsChanged()
      offWorkspaceTabsChanged()
    }
  }, [currentRepoId, currentRepoInstanceToken, syncServerSessions])

  const commandValue = useMemo<TerminalSessionContextValue>(
    () => ({
      createTerminal: projection.createTerminal,
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
      serialize: projection.serialize,
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
    <TerminalSessionContext.Provider value={commandValue}>
      <TerminalSessionReadContext.Provider value={readValue}>
        {children}
        <div ref={parkingRootRef} className="goblin-terminal-parking" aria-hidden="true" />
      </TerminalSessionReadContext.Provider>
    </TerminalSessionContext.Provider>
  )
}

function applyWorkspaceTabsForRepo(
  repoRoot: string,
  entries: readonly TerminalWorkspaceTabsEntry[],
  repoIndex: ReturnType<typeof repoIndexFromRepos>,
): void {
  for (const entry of entries) {
    applyWorkspaceTabsForWorktree(repoRoot, entry.worktreePath, entry.tabs, repoIndex)
  }
}

function applyWorkspaceTabsForWorktree(
  repoRoot: string,
  worktreePath: string,
  tabs: readonly WorkspacePaneTabEntry[],
  repoIndex: ReturnType<typeof repoIndexFromRepos>,
): void {
  if (!worktreePath) return
  const storeRepoRoot =
    repoIndex[repoRoot] !== undefined
      ? repoRoot
      : (Object.keys(repoIndex).find((candidate) => repoIndex[candidate]?.branchByWorktreePath[worktreePath]) ??
        repoRoot)
  const branch = repoIndex[storeRepoRoot]?.branchByWorktreePath[worktreePath]
  if (!branch) return
  useReposStore.getState().replaceWorkspacePaneTabs(storeRepoRoot, [...tabs], branch)
}
