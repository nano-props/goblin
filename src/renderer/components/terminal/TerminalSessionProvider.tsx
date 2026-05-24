import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import '#/renderer/components/terminal/terminal-session.css'
import { setTerminalFocused } from '#/renderer/terminal-focus.ts'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import { terminalBridge } from '#/renderer/terminal.ts'
import { ManagedTerminalSession } from '#/renderer/components/terminal/ManagedTerminalSession.ts'
import { isTerminalDescriptorLive } from '#/renderer/components/terminal/terminal-session-utils.ts'
import { TerminalSessionContext } from '#/renderer/components/terminal/terminal-session-context.ts'
import type { TerminalDescriptor, TerminalSessionContextValue } from '#/renderer/components/terminal/types.ts'

interface TerminalSessionProviderProps {
  children: ReactNode
}

export function TerminalSessionProvider({ children }: TerminalSessionProviderProps) {
  const repos = useReposStore((s) => s.repos)
  const parkingRootRef = useRef<HTMLDivElement | null>(null)
  const sessionsRef = useRef(new Map<string, ManagedTerminalSession>())
  const [version, setVersion] = useState(0)
  const notify = useCallback(() => setVersion((current) => current + 1), [])

  useEffect(() => {
    const offOutput = terminalBridge.onOutput((event) => {
      for (const session of sessionsRef.current.values()) session.handleOutput(event)
    })
    const offExit = terminalBridge.onExit((event) => {
      for (const [key, session] of Array.from(sessionsRef.current.entries())) {
        if (!session.handleExit(event)) continue
        const { repoRoot, worktreePath } = session.descriptor
        sessionsRef.current.delete(key)
        session.dispose()
        useReposStore.getState().dismissExitedTerminalDetail(repoRoot, worktreePath)
        notify()
        break
      }
    })
    return () => {
      offOutput()
      offExit()
    }
  }, [notify])

  useEffect(() => {
    const sessions = sessionsRef.current
    return () => {
      setTerminalFocused(false)
      for (const session of sessions.values()) session.dispose()
      sessions.clear()
    }
  }, [])

  useEffect(() => {
    let changed = false
    for (const [key, session] of Array.from(sessionsRef.current.entries())) {
      if (!isTerminalDescriptorLive(repos, session.descriptor)) {
        changed = true
        sessionsRef.current.delete(key)
        session.dispose()
      }
    }
    if (changed) notify()
  }, [notify, repos])

  const ensureSession = useCallback(
    (descriptor: TerminalDescriptor): ManagedTerminalSession => {
      const current = sessionsRef.current.get(descriptor.key)
      if (current) {
        current.updateDescriptor(descriptor)
        return current
      }
      const session = new ManagedTerminalSession(descriptor, notify)
      sessionsRef.current.set(descriptor.key, session)
      return session
    },
    [notify],
  )

  const attach = useCallback(
    (descriptor: TerminalDescriptor, host: HTMLElement) => {
      ensureSession(descriptor).attach(host)
    },
    [ensureSession],
  )

  const detach = useCallback((key: string, host: HTMLElement) => {
    const session = sessionsRef.current.get(key)
    const parkingRoot = parkingRootRef.current
    if (session && parkingRoot) session.detach(host, parkingRoot)
  }, [])

  const restart = useCallback((key: string) => {
    sessionsRef.current.get(key)?.restart()
  }, [])

  const snapshot = useCallback((key: string) => {
    return sessionsRef.current.get(key)?.snapshot() ?? { phase: 'opening' as const, message: null }
  }, [])

  const isTerminalFocusTarget = useCallback((key: string, target: EventTarget | null): boolean => {
    return sessionsRef.current.get(key)?.isTerminalFocusTarget(target) ?? false
  }, [])

  const findNext = useCallback((key: string, term: string, incremental?: boolean) => {
    return (
      sessionsRef.current.get(key)?.findNext(term, incremental) ?? { resultIndex: -1, resultCount: 0, found: false }
    )
  }, [])

  const findPrevious = useCallback((key: string, term: string) => {
    return sessionsRef.current.get(key)?.findPrevious(term) ?? { resultIndex: -1, resultCount: 0, found: false }
  }, [])

  const clearSearch = useCallback((key: string) => {
    sessionsRef.current.get(key)?.clearSearch()
  }, [])

  const serialize = useCallback((key: string) => {
    return sessionsRef.current.get(key)?.serialize() ?? ''
  }, [])

  const value = useMemo<TerminalSessionContextValue>(
    () => ({
      version,
      attach,
      detach,
      restart,
      snapshot,
      isTerminalFocusTarget,
      findNext,
      findPrevious,
      clearSearch,
      serialize,
    }),
    [attach, clearSearch, detach, findNext, findPrevious, isTerminalFocusTarget, restart, serialize, snapshot, version],
  )

  return (
    <TerminalSessionContext.Provider value={value}>
      {children}
      <div ref={parkingRootRef} className="goblin-terminal-parking" aria-hidden="true" />
    </TerminalSessionContext.Provider>
  )
}
