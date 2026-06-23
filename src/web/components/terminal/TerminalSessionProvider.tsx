import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useStoreWithEqualityFn } from 'zustand/traditional'

import type { TerminalSlotSnapshot, TerminalSlotSummary } from '#/shared/terminal-types.ts'
import '#/web/components/terminal/terminal-session.css'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { useRepoSyncStore } from '#/web/stores/repo-sync.ts'
import { terminalBridge } from '#/web/terminal.ts'
import { terminalSessionProviderLog } from '#/web/logger.ts'
import {
  TerminalSessionContext,
  TerminalSessionReadContext,
} from '#/web/components/terminal/terminal-session-context.ts'
import { readOrCreateWebTerminalClientId } from '#/web/renderer-terminal-bridge.ts'
import { preloadTerminalFont } from '#/web/components/terminal/terminal-geometry.ts'
import { loadTerminalSessions } from '#/web/terminal-session-queries.ts'
import {
  TerminalSessionRegistry,
  getTerminalSessionRegistry,
} from '#/web/components/terminal/TerminalSessionRegistry.ts'
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
  // prop. This keeps the terminal session registry, parking root, and
  // xterm views alive across settings → workspace round-trips.
  const currentRepoId = useReposStore((s) => s.activeId)
  const currentRepoInstanceToken = currentRepoId ? (repoIndex[currentRepoId]?.instanceToken ?? null) : null
  const selectedTerminalByWorktree = useReposStore((s) => s.selectedTerminalByWorktree)
  const setSelectedTerminal = useReposStore((s) => s.setSelectedTerminal)
  const parkingRootRef = useRef<HTMLDivElement | null>(null)
  const currentRepoIdRef = useRef(currentRepoId)
  currentRepoIdRef.current = currentRepoId
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
  // shared socket, so watching currentRepoId (not worktreeTerminalKey)
  // is the right granularity: one handshake per repo visit, not one per
  // worktree tab. The prewarm is fire-and-forget — failures are
  // swallowed inside the bridge; the next real IPC will surface a real
  // error if the server is unreachable.
  useEffect(() => {
    if (!currentRepoId) return
    void terminalBridge.prewarm()
  }, [currentRepoId])

  // The registry is a renderer-level singleton (terminal-roadmap.md P1.7).
  // The first Provider mount constructs it via `getTerminalSessionRegistry`;
  // subsequent mounts (StrictMode re-mount, route round-trip) reuse the
  // same instance. The ref is kept only so the rest of this component can
  // reach the singleton without re-calling the getter on every render.
  const registryRef = useRef<TerminalSessionRegistry | null>(null)
  if (!registryRef.current) {
    registryRef.current = getTerminalSessionRegistry({
      getCurrentRepoId: () => currentRepoIdRef.current,
      onSelectedWorktreeChange: setSelectedTerminal,
      // Terminal-session lifetime owns terminal tab lifetime. User closes,
      // server exits, and reconcile removals all converge through this hook.
      // The workspace pane tab model falls back to the first materialized tab
      // at read time when the active tab disappears, so this callback only
      // needs to drop the tab from the branch-scoped tab order — no
      // navigation or view-switch call required.
      onTerminalSessionRemoved: (key, base) => {
        useReposStore.getState().removeWorkspacePaneTerminalTab(base.repoRoot, key, base.branch)
      },
    })
  }
  const registry = registryRef.current

  const loadMissingSnapshots = useCallback(
    async (serverSessions: TerminalSlotSummary[]): Promise<Map<string, TerminalSlotSnapshot>> => {
      // allSettled (not all) so a single rejected snapshot fetch does not
      // cancel the rest of the reconciliation. Each request is bounded by
      // the bridge's per-request timeout, so the worst case here is that
      // one slow session delays the final map by that timeout — but every
      // other session's snapshot is delivered to the caller regardless.
      // Rejections are surfaced via `result.reason` so they remain visible
      // in logs without poisoning the reconciliation.
      const settled = await Promise.allSettled(
        serverSessions.map((session) => terminalBridge.getSlotSnapshot({ ptySessionId: session.ptySessionId })),
      )
      const entries: Array<readonly [string, TerminalSlotSnapshot]> = []
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
    [registry],
  )

  const syncServerSessions = useCallback(
    async (repoRoot: string) => {
      if (!repoRoot || !repoIndexRef.current[repoRoot]) return
      try {
        const clientId = readOrCreateWebTerminalClientId()
        const serverSessions = await loadTerminalSessions(repoRoot)
        const snapshotsBySessionId = await loadMissingSnapshots(serverSessions)
        if (!repoIndexRef.current[repoRoot]) return
        registry.reconcileServerSessions(repoRoot, serverSessions, clientId, snapshotsBySessionId)
      } catch (err) {
        terminalSessionProviderLog.debug('failed to sync server sessions', { err })
      } finally {
        const instanceToken = repoIndexRef.current[repoRoot]?.instanceToken
        if (typeof instanceToken === 'number') {
          useRepoSyncStore.getState().markReady(repoRoot, instanceToken)
        }
      }
    },
    [loadMissingSnapshots, registry],
  )

  // Registry state sync
  useEffect(() => {
    registry.setRepoIndex(repoIndex)
    registry.setPreferredSelectedTerminalKeys(selectedTerminalByWorktree)
  }, [registry, repoIndex, selectedTerminalByWorktree])

  // Parking DOM
  useEffect(() => {
    registry.setParkingRoot(parkingRootRef.current)
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

  // Registry event wiring (singleton lifecycle, see terminal-roadmap.md P1.7).
  // The registry is renderer-level; we only subscribe / unsubscribe bridge
  // events on mount/unmount. We do NOT destroy the registry — the singleton
  // outlives the Provider. StrictMode re-mounts simply re-register the same
  // listeners against the same instance.
  useEffect(() => {
    const offOutput = terminalBridge.onOutput((event) => {
      registry.handleOutput(event)
    })
    const offTitle = terminalBridge.onTitle((event) => {
      registry.handleServerTitle(event)
    })
    const offExit = terminalBridge.onExit((event) => {
      registry.handleExit(event)
    })
    const offOwnership = terminalBridge.onOwnership((event) => {
      registry.handleOwnership(event)
    })
    // Per-session close broadcast. When the server confirms a close,
    // drop the matching local entry immediately so a sibling window
    // (or a stale local entry from a lost close in the current
    // window) doesn't reattach to the orphan. The originating window
    // already disposed the local entry, so the handler is a no-op
    // there — the broadcast is multi-window safe by construction.
    const offSlotClosed = terminalBridge.onSlotClosed((event) => {
      registry.handleSlotClosed(event.ptySessionId)
    })

    setTerminalSessionCommandBridge({
      worktreeSnapshot: registry.worktreeSnapshot,
      createTerminal: registry.createTerminal,
      selectTerminal: registry.selectTerminal,
      closeTerminalByDescriptor: registry.closeTerminalByDescriptor,
    })

    return () => {
      offOutput()
      offTitle()
      offExit()
      offOwnership()
      offSlotClosed()
    }
  }, [registry])

  // Server sync (initial + focus + external session changes)
  useEffect(() => {
    if (!currentRepoId) return
    void syncServerSessions(currentRepoId)

    const handleFocus = () => {
      if (!currentRepoIdRef.current) return
      const repoRoot = currentRepoIdRef.current
      if (!useRepoSyncStore.getState().shouldSync(repoRoot)) return
      void syncServerSessions(repoRoot)
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

    return () => {
      disposed = true
      if (syncTimer !== null) window.clearTimeout(syncTimer)
      window.removeEventListener('focus', handleFocus)
      offSessionsChanged()
    }
  }, [currentRepoId, currentRepoInstanceToken, syncServerSessions])

  const commandValue = useMemo<TerminalSessionContextValue>(
    () => ({
      createTerminal: registry.createTerminal,
      registerHost: registry.registerHost,
      unregisterHost: registry.unregisterHost,
      selectTerminal: registry.selectTerminal,
      scrollToBottom: registry.scrollToBottom,
      scrollLines: registry.scrollLines,
      clearBell: registry.clearBell,
      closeTerminalByDescriptor: registry.closeTerminalByDescriptor,
      attach: registry.attach,
      detach: registry.detach,
      restart: registry.restart,
      isTerminalFocusTarget: registry.isTerminalFocusTarget,
      findNext: registry.findNext,
      findPrevious: registry.findPrevious,
      clearSearch: registry.clearSearch,
      writeInput: registry.writeInput,
      takeover: registry.takeover,
      serialize: registry.serialize,
    }),
    [registry],
  )
  const readValue = useMemo<TerminalSessionReadContextValue>(
    () => ({
      worktreeSnapshot: registry.worktreeSnapshot,
      subscribeWorktree: registry.subscribeWorktree,
      snapshot: registry.snapshot,
      subscribeSnapshot: registry.subscribeSnapshot,
    }),
    [registry],
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
