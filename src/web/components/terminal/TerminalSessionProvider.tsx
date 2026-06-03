import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import type { TerminalSessionSnapshot, TerminalSessionSummary } from '#/shared/terminal.ts'
import '#/web/components/terminal/terminal-session.css'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { terminalBridge } from '#/web/terminal.ts'
import { TerminalSessionContext, TerminalSessionReadContext } from '#/web/components/terminal/terminal-session-context.ts'
import { readOrCreateWebTerminalAttachmentId } from '#/web/renderer-terminal-bridge.ts'
import { mainWindowQueryClient } from '#/web/main-window-queries.ts'
import { terminalSessionsQueryKey, terminalSessionsQueryOptions } from '#/web/terminal-session-queries.ts'
import { TerminalSessionRegistry } from '#/web/components/terminal/TerminalSessionRegistry.ts'
import { setTerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import type { TerminalSessionContextValue, TerminalSessionReadContextValue } from '#/web/components/terminal/types.ts'

interface TerminalSessionProviderProps {
  currentRepoId: string | null
  children: ReactNode
}

export function TerminalSessionProvider({ currentRepoId, children }: TerminalSessionProviderProps) {
  const repos = useReposStore((s) => s.repos)
  const selectedTerminalByWorktree = useReposStore((s) => s.selectedTerminalByWorktree)
  const setSelectedTerminal = useReposStore((s) => s.setSelectedTerminal)
  const parkingRootRef = useRef<HTMLDivElement | null>(null)
  const currentRepoIdRef = useRef(currentRepoId)
  currentRepoIdRef.current = currentRepoId
  const repoSyncReadyRef = useRef(new Map<string, number>())
  const repoSyncListenersRef = useRef(new Map<string, Set<() => void>>())

  const registryRef = useRef<TerminalSessionRegistry | null>(null)
  if (!registryRef.current) {
    registryRef.current = new TerminalSessionRegistry(() => currentRepoIdRef.current, setSelectedTerminal)
  }
  const registry = registryRef.current
  registry.setParkingRoot(parkingRootRef.current)

  const loadMissingSnapshots = async (serverSessions: TerminalSessionSummary[]): Promise<Map<string, TerminalSessionSnapshot>> => {
    const snapshotEntries = await Promise.all(
      serverSessions.map(async (session) => {
        if (registry.hasCachedServerSnapshot(session.key, session.sessionId)) return null
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
  }

  const markRepoSyncReady = (repoRoot: string) => {
    const instanceToken = repos[repoRoot]?.instanceToken
    if (typeof instanceToken !== 'number') return
    if (repoSyncReadyRef.current.get(repoRoot) === instanceToken) return
    repoSyncReadyRef.current.set(repoRoot, instanceToken)
    const listeners = repoSyncListenersRef.current.get(repoRoot)
    if (!listeners) return
    for (const listener of Array.from(listeners)) listener()
  }

  useEffect(() => {
    registry.setParkingRoot(parkingRootRef.current)
  })

  useEffect(() => {
    registry.setRepos(repos)
  }, [registry, repos])

  useEffect(() => {
    registry.setPreferredSelectedTerminalKeys(selectedTerminalByWorktree)
  }, [selectedTerminalByWorktree, registry])

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
    return () => {
      offOutput()
      offTitle()
      offExit()
      offOwnership()
    }
  }, [registry])

  useEffect(() => {
    return () => {
      registry.destroy()
    }
  }, [registry])

  useEffect(() => {
    return setTerminalSessionCommandBridge({
      worktreeSnapshot: registry.worktreeSnapshot,
      createTerminal: registry.createTerminal,
    })
  }, [registry])

  useEffect(() => {
    const syncServerSessions = async (repoRoot?: string) => {
      try {
        const attachmentId = readOrCreateWebTerminalAttachmentId()
        const repoRoots = repoRoot ? new Set([repoRoot]) : new Set<string>()
        if (!repoRoot) {
          for (const repo of Object.values(repos)) {
            if (repo.id) repoRoots.add(repo.id)
          }
        }
        for (const root of repoRoots) {
          try {
            const serverSessions = await mainWindowQueryClient.fetchQuery(terminalSessionsQueryOptions(root))
            const snapshotsBySessionId = await loadMissingSnapshots(serverSessions)
            registry.reconcileServerSessions(root, serverSessions, attachmentId, snapshotsBySessionId)
          } catch (err) {
            console.debug('[TerminalSessionProvider] failed to sync server sessions:', err)
          } finally {
            markRepoSyncReady(root)
          }
        }
      } catch (err) {
        console.debug('[TerminalSessionProvider] failed to sync sessions:', err)
      }
    }

    void syncServerSessions()
    const handleFocus = () => {
      if (!currentRepoIdRef.current) return
      void syncServerSessions(currentRepoIdRef.current)
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
  }, [registry, repos])

  const commandValue = useMemo<TerminalSessionContextValue>(
    () => ({
      createTerminal: registry.createTerminal,
      selectTerminal: registry.selectTerminal,
      scrollToBottom: registry.scrollToBottom,
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
      serialize: registry.serialize,
    }),
    [registry],
  )
  const readValue = useMemo<TerminalSessionReadContextValue>(
    () => ({
      worktreeSnapshot: registry.worktreeSnapshot,
      subscribeWorktree: registry.subscribeWorktree,
      repoSyncReady: (repoRoot: string) => {
        const instanceToken = repos[repoRoot]?.instanceToken
        return typeof instanceToken === 'number' && repoSyncReadyRef.current.get(repoRoot) === instanceToken
      },
      subscribeRepoSync: (repoRoot: string, listener: () => void) => {
        let listeners = repoSyncListenersRef.current.get(repoRoot)
        if (!listeners) {
          listeners = new Set()
          repoSyncListenersRef.current.set(repoRoot, listeners)
        }
        listeners.add(listener)
        return () => {
          const current = repoSyncListenersRef.current.get(repoRoot)
          if (!current) return
          current.delete(listener)
          if (current.size === 0) repoSyncListenersRef.current.delete(repoRoot)
        }
      },
      snapshot: registry.snapshot,
      subscribeSnapshot: registry.subscribeSnapshot,
    }),
    [registry, repos],
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
