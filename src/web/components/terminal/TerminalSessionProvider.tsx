import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useStoreWithEqualityFn } from 'zustand/traditional'

import type { TerminalSessionSnapshot, TerminalSessionSummary } from '#/shared/terminal.ts'
import '#/web/components/terminal/terminal-session.css'
import { useReposStore } from '#/web/stores/repos/store.ts'
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
import { RepoSyncTracker } from '#/web/components/terminal/repo-sync-tracker.ts'
import type { TerminalSessionContextValue, TerminalSessionReadContextValue } from '#/web/components/terminal/types.ts'

interface TerminalSessionProviderProps {
  currentRepoId: string | null
  children: ReactNode
  /** @internal For tests only. */
  syncTracker?: RepoSyncTracker
}

export function TerminalSessionProvider({
  currentRepoId,
  children,
  syncTracker: syncTrackerProp,
}: TerminalSessionProviderProps) {
  const repoIndex = useStoreWithEqualityFn(useReposStore, (s) => repoIndexFromRepos(s.repos), repoIndexEqual)
  const currentRepoInstanceToken = currentRepoId ? (repoIndex[currentRepoId]?.instanceToken ?? null) : null
  const selectedTerminalByWorktree = useReposStore((s) => s.selectedTerminalByWorktree)
  const setSelectedTerminal = useReposStore((s) => s.setSelectedTerminal)
  const dismissExitedTerminalDetail = useReposStore((s) => s.dismissExitedTerminalDetail)
  const parkingRootRef = useRef<HTMLDivElement | null>(null)
  const currentRepoIdRef = useRef(currentRepoId)
  currentRepoIdRef.current = currentRepoId
  const repoIndexRef = useRef(repoIndex)
  repoIndexRef.current = repoIndex

  const syncTrackerRef = useRef(syncTrackerProp ?? new RepoSyncTracker())
  const syncTracker = syncTrackerRef.current

  const registryRef = useRef<TerminalSessionRegistry | null>(null)
  if (!registryRef.current) {
    registryRef.current = new TerminalSessionRegistry(
      () => currentRepoIdRef.current,
      setSelectedTerminal,
      (repoRoot, worktreePath) => dismissExitedTerminalDetail(repoRoot, worktreePath),
    )
  }
  const registry = registryRef.current

  const loadMissingSnapshots = useCallback(
    async (serverSessions: TerminalSessionSummary[]): Promise<Map<string, TerminalSessionSnapshot>> => {
      const snapshotEntries = await Promise.all(
        serverSessions.map(async (session) => {
          try {
            const snapshot = await terminalBridge.getSessionSnapshot({ sessionId: session.sessionId })
            return snapshot ? ([session.sessionId, snapshot] as const) : null
          } catch (err) {
            console.debug('[TerminalSessionProvider] failed to load terminal session snapshot:', err)
            return null
          }
        }),
      )
      return new Map(snapshotEntries.filter((entry) => entry !== null))
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
          syncTracker.markReady(repoRoot, instanceToken)
        }
      }
    },
    [loadMissingSnapshots, registry, syncTracker],
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
      if (!syncTracker.shouldSync(repoRoot)) return
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
  }, [currentRepoId, currentRepoInstanceToken, syncServerSessions, syncTracker])

  const commandValue = useMemo<TerminalSessionContextValue>(
    () => ({
      createTerminal: registry.createTerminal,
      selectTerminal: registry.selectTerminal,
      scrollToBottom: registry.scrollToBottom,
      scrollLines: registry.scrollLines,
      clearBell: registry.clearBell,
      closeTerminalAndDismissDetailIfLast: registry.closeTerminalAndDismissDetailIfLast,
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
      repoSyncReady: (repoRoot: string) => {
        const instanceToken = repoIndex[repoRoot]?.instanceToken
        return syncTracker.isReady(repoRoot, instanceToken)
      },
      subscribeRepoSync: syncTracker.subscribe,
      snapshot: registry.snapshot,
      subscribeSnapshot: registry.subscribeSnapshot,
    }),
    [registry, repoIndex, syncTracker],
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
