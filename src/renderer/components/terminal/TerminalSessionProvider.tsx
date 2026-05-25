import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import '#/renderer/components/terminal/terminal-session.css'
import { setTerminalFocused } from '#/renderer/terminal-focus.ts'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import { terminalBridge } from '#/renderer/terminal.ts'
import { ManagedTerminalSession } from '#/renderer/components/terminal/ManagedTerminalSession.ts'
import {
  isTerminalDescriptorLive,
  terminalDescriptor,
  terminalSessionGroupKey,
} from '#/renderer/components/terminal/terminal-session-utils.ts'
import { TerminalSessionContext } from '#/renderer/components/terminal/terminal-session-context.ts'
import type {
  TerminalDescriptor,
  TerminalSessionBase,
  TerminalSessionContextValue,
  TerminalSessionSummary,
} from '#/renderer/components/terminal/types.ts'

interface TerminalSessionProviderProps {
  children: ReactNode
}

export function TerminalSessionProvider({ children }: TerminalSessionProviderProps) {
  const repos = useReposStore((s) => s.repos)
  const parkingRootRef = useRef<HTMLDivElement | null>(null)
  const sessionsRef = useRef(new Map<string, ManagedTerminalSession>())
  const activeKeyByGroupRef = useRef(new Map<string, string>())
  const nextIndexByGroupRef = useRef(new Map<string, number>())
  const [version, setVersion] = useState(0)
  const notify = useCallback(() => setVersion((current) => current + 1), [])

  function removeSession(key: string, options: { dispose: boolean }): boolean {
    const session = sessionsRef.current.get(key)
    if (!session) return false
    const groupKey = session.descriptor.groupKey
    sessionsRef.current.delete(key)
    if (options.dispose) session.dispose()
    if (activeKeyByGroupRef.current.get(groupKey) === key) {
      const next = Array.from(sessionsRef.current.values())
        .filter((candidate) => candidate.descriptor.groupKey === groupKey)
        .sort((a, b) => a.descriptor.index - b.descriptor.index)[0]
      if (next) activeKeyByGroupRef.current.set(groupKey, next.descriptor.key)
      else activeKeyByGroupRef.current.delete(groupKey)
    }
    return true
  }

  useEffect(() => {
    const offOutput = terminalBridge.onOutput((event) => {
      for (const session of sessionsRef.current.values()) session.handleOutput(event)
    })
    const offExit = terminalBridge.onExit((event) => {
      for (const [key, session] of Array.from(sessionsRef.current.entries())) {
        if (!session.handleExit(event)) continue
        const { repoRoot, worktreePath } = session.descriptor
        removeSession(key, { dispose: true })
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
      activeKeyByGroupRef.current.clear()
      nextIndexByGroupRef.current.clear()
    }
  }, [])

  useEffect(() => {
    let changed = false
    for (const [key, session] of Array.from(sessionsRef.current.entries())) {
      if (!isTerminalDescriptorLive(repos, session.descriptor)) {
        changed = true
        removeSession(key, { dispose: true })
      }
    }
    if (changed) notify()
  }, [notify, repos])

  const createTerminalDescriptor = useCallback((base: TerminalSessionBase): TerminalDescriptor => {
    const groupKey = terminalSessionGroupKey(base.repoRoot, base.worktreePath)
    const index = nextIndexByGroupRef.current.get(groupKey) ?? 1
    nextIndexByGroupRef.current.set(groupKey, index + 1)
    return terminalDescriptor(base, `terminal-${index}`, index)
  }, [])

  const ensureSession = useCallback(
    (descriptor: TerminalDescriptor): ManagedTerminalSession => {
      const current = sessionsRef.current.get(descriptor.key)
      if (current) {
        current.updateDescriptor(descriptor)
        return current
      }
      const session = new ManagedTerminalSession(descriptor, notify)
      sessionsRef.current.set(descriptor.key, session)
      if (!activeKeyByGroupRef.current.has(descriptor.groupKey)) {
        activeKeyByGroupRef.current.set(descriptor.groupKey, descriptor.key)
      }
      return session
    },
    [notify],
  )

  const ensureDefault = useCallback(
    (base: TerminalSessionBase): string => {
      const groupKey = terminalSessionGroupKey(base.repoRoot, base.worktreePath)
      const activeKey = activeKeyByGroupRef.current.get(groupKey)
      if (activeKey && sessionsRef.current.has(activeKey)) return activeKey
      const existing = Array.from(sessionsRef.current.values()).find(
        (session) => session.descriptor.groupKey === groupKey,
      )
      if (existing) {
        activeKeyByGroupRef.current.set(groupKey, existing.descriptor.key)
        return existing.descriptor.key
      }
      const descriptor = createTerminalDescriptor(base)
      ensureSession(descriptor)
      activeKeyByGroupRef.current.set(groupKey, descriptor.key)
      notify()
      return descriptor.key
    },
    [createTerminalDescriptor, ensureSession, notify],
  )

  const createTerminal = useCallback(
    (base: TerminalSessionBase): string => {
      const descriptor = createTerminalDescriptor(base)
      ensureSession(descriptor)
      activeKeyByGroupRef.current.set(descriptor.groupKey, descriptor.key)
      notify()
      return descriptor.key
    },
    [createTerminalDescriptor, ensureSession, notify],
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

  const activeDescriptor = useCallback((groupKey: string): TerminalDescriptor | null => {
    const activeKey = activeKeyByGroupRef.current.get(groupKey)
    return activeKey ? (sessionsRef.current.get(activeKey)?.descriptor ?? null) : null
  }, [])

  const sessionSummaries = useCallback((groupKey: string): TerminalSessionSummary[] => {
    const activeKey = activeKeyByGroupRef.current.get(groupKey) ?? null
    return Array.from(sessionsRef.current.values())
      .filter((session) => session.descriptor.groupKey === groupKey)
      .sort((a, b) => a.descriptor.index - b.descriptor.index)
      .map((session) => {
        const snapshot = session.snapshot()
        return {
          key: session.descriptor.key,
          groupKey,
          terminalId: session.descriptor.terminalId,
          index: session.descriptor.index,
          title: snapshot.processName || `terminal ${session.descriptor.index}`,
          phase: snapshot.phase,
          active: session.descriptor.key === activeKey,
        }
      })
  }, [])

  const setActive = useCallback(
    (groupKey: string, key: string) => {
      const session = sessionsRef.current.get(key)
      if (!session || session.descriptor.groupKey !== groupKey) return
      activeKeyByGroupRef.current.set(groupKey, key)
      notify()
    },
    [notify],
  )

  const closeTerminal = useCallback(
    (key: string): TerminalSessionSummary[] => {
      const groupKey = sessionsRef.current.get(key)?.descriptor.groupKey
      if (!removeSession(key, { dispose: true })) return groupKey ? sessionSummaries(groupKey) : []
      notify()
      return groupKey ? sessionSummaries(groupKey) : []
    },
    [notify, sessionSummaries],
  )

  const restart = useCallback((key: string) => {
    sessionsRef.current.get(key)?.restart()
  }, [])

  const snapshot = useCallback((key: string) => {
    return (
      sessionsRef.current.get(key)?.snapshot() ?? { phase: 'opening' as const, message: null, processName: 'terminal' }
    )
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
      ensureDefault,
      createTerminal,
      activeDescriptor,
      sessionSummaries,
      setActive,
      closeTerminal,
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
    [
      activeDescriptor,
      attach,
      clearSearch,
      closeTerminal,
      createTerminal,
      detach,
      ensureDefault,
      findNext,
      findPrevious,
      isTerminalFocusTarget,
      restart,
      serialize,
      sessionSummaries,
      setActive,
      snapshot,
      version,
    ],
  )

  return (
    <TerminalSessionContext.Provider value={value}>
      {children}
      <div ref={parkingRootRef} className="goblin-terminal-parking" aria-hidden="true" />
    </TerminalSessionContext.Provider>
  )
}
