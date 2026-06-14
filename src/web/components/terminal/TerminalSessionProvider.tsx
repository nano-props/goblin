import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useStoreWithEqualityFn } from 'zustand/traditional'

import type { TerminalSessionSnapshot, TerminalSessionSummary } from '#/shared/terminal.ts'
import '#/web/components/terminal/terminal-session.css'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { useRepoSyncStore } from '#/web/stores/repo-sync.ts'
import { terminalBridge } from '#/web/terminal.ts'
import {
  TerminalSessionContext,
  TerminalSessionReadContext,
} from '#/web/components/terminal/terminal-session-context.ts'
import { readOrCreateWebTerminalAttachmentId } from '#/web/renderer-terminal-bridge.ts'
import { mainWindowQueryClient } from '#/web/main-window-queries.ts'
import { terminalSessionsQueryKey, terminalSessionsQueryOptions } from '#/web/terminal-session-queries.ts'
import { TerminalSessionRegistry } from '#/web/components/terminal/TerminalSessionRegistry.ts'
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

  const registryRef = useRef<TerminalSessionRegistry | null>(null)
  if (!registryRef.current) {
    registryRef.current = new TerminalSessionRegistry(() => currentRepoIdRef.current, setSelectedTerminal)
  }
  const registry = registryRef.current

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
        serverSessions.map((session) => terminalBridge.getSessionSnapshot({ sessionId: session.sessionId })),
      )
      const entries: Array<readonly [string, TerminalSessionSnapshot]> = []
      settled.forEach((result, index) => {
        const session = serverSessions[index]
        if (!session) return
        if (result.status === 'fulfilled') {
          const snapshot = result.value
          if (snapshot) entries.push([session.sessionId, snapshot])
          return
        }
        console.debug(
          '[TerminalSessionProvider] failed to load terminal session snapshot:',
          session.sessionId,
          result.reason,
        )
      })
      return new Map(entries)
    },
    [registry],
  )

  const syncServerSessions = useCallback(
    async (repoRoot: string) => {
      if (!repoRoot || !repoIndexRef.current[repoRoot]) return
      try {
        const attachmentId = readOrCreateWebTerminalAttachmentId()
        const serverSessions = await mainWindowQueryClient.fetchQuery(terminalSessionsQueryOptions(repoRoot))
        const snapshotsBySessionId = await loadMissingSnapshots(serverSessions)
        if (!repoIndexRef.current[repoRoot]) return
        registry.reconcileServerSessions(repoRoot, serverSessions, attachmentId, snapshotsBySessionId)
      } catch (err) {
        console.debug('[TerminalSessionProvider] failed to sync server sessions:', err)
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

  // Registry lifecycle (event listeners + bridge + destroy)
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

    setTerminalSessionCommandBridge({
      worktreeSnapshot: registry.worktreeSnapshot,
      createTerminal: registry.createTerminal,
      selectTerminal: registry.selectTerminal,
    })

    return () => {
      offOutput()
      offTitle()
      offExit()
      offOwnership()
      registry.destroy()
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

    const offSessionsChanged = terminalBridge.onSessionsChanged((repoRoot) => {
      void mainWindowQueryClient.invalidateQueries({ queryKey: terminalSessionsQueryKey(repoRoot), exact: true })
      void syncServerSessions(repoRoot)
    })

    return () => {
      window.removeEventListener('focus', handleFocus)
      offSessionsChanged()
    }
  }, [currentRepoId, currentRepoInstanceToken, syncServerSessions])

  const commandValue = useMemo<TerminalSessionContextValue>(
    () => ({
      createTerminal: registry.createTerminal,
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
      reorderSessions: registry.reorderSessions,
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
