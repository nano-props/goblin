import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { useTerminalSessionReadContext } from '#/web/components/terminal/terminal-session-context.ts'
import {
  useTerminalProjectionHydrationEntry,
  useTerminalProjectionHydrationPhase,
  type TerminalProjectionHydrationEntry,
  type TerminalProjectionHydrationPhase,
} from '#/web/stores/terminal-projection-hydration.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { TerminalSnapshot, TerminalDescriptor, TerminalSessionSummary } from '#/web/components/terminal/types.ts'

const EMPTY_TERMINAL_SNAPSHOT: TerminalSnapshot = { phase: 'opening', message: null, processName: 'terminal' }
const EMPTY_TERMINAL_SESSION_SUMMARIES: TerminalSessionSummary[] = []

export function useTerminalWorktreeCount(terminalWorktreeKey: string | null): number {
  const { terminalWorktreeSnapshot, subscribeTerminalWorktree } = useTerminalSessionReadContext()
  const subscribe = useCallback(
    (listener: () => void) =>
      terminalWorktreeKey ? subscribeTerminalWorktree(terminalWorktreeKey, listener) : () => {},
    [terminalWorktreeKey, subscribeTerminalWorktree],
  )
  const getSnapshot = useCallback(
    () => (terminalWorktreeKey ? terminalWorktreeSnapshot(terminalWorktreeKey).count : 0),
    [terminalWorktreeKey, terminalWorktreeSnapshot],
  )
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function useTerminalWorktreeCreatePending(terminalWorktreeKey: string | null): boolean {
  const { terminalWorktreeSnapshot, subscribeTerminalWorktree } = useTerminalSessionReadContext()
  const subscribe = useCallback(
    (listener: () => void) =>
      terminalWorktreeKey ? subscribeTerminalWorktree(terminalWorktreeKey, listener) : () => {},
    [terminalWorktreeKey, subscribeTerminalWorktree],
  )
  const getSnapshot = useCallback(
    () => (terminalWorktreeKey ? terminalWorktreeSnapshot(terminalWorktreeKey).createPending : false),
    [terminalWorktreeKey, terminalWorktreeSnapshot],
  )
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function useTerminalWorktreeBellCount(terminalWorktreeKey: string | null): number {
  const { terminalWorktreeSnapshot, subscribeTerminalWorktree } = useTerminalSessionReadContext()
  const subscribe = useCallback(
    (listener: () => void) =>
      terminalWorktreeKey ? subscribeTerminalWorktree(terminalWorktreeKey, listener) : () => {},
    [terminalWorktreeKey, subscribeTerminalWorktree],
  )
  const getSnapshot = useCallback(
    () => (terminalWorktreeKey ? terminalWorktreeSnapshot(terminalWorktreeKey).bellCount : 0),
    [terminalWorktreeKey, terminalWorktreeSnapshot],
  )
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function useRepoTerminalBellCounts(repoIds: readonly string[]): Record<string, number> {
  const { repoBellCount, subscribeRepoBellCount } = useTerminalSessionReadContext()
  const subscribe = useCallback(
    (listener: () => void) => {
      const uniqueRepoIds = Array.from(new Set(repoIds))
      if (uniqueRepoIds.length === 0) return () => {}
      const unsubscribe = uniqueRepoIds.map((repoId) => subscribeRepoBellCount(repoId, listener))
      return () => {
        for (const off of unsubscribe) off()
      }
    },
    [repoIds, subscribeRepoBellCount],
  )
  const getSnapshot = useCallback(() => {
    return JSON.stringify(repoIds.map((repoId) => [repoId, repoBellCount(repoId)] as const))
  }, [repoIds, repoBellCount])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return useMemo(() => {
    const entries = JSON.parse(snapshot) as Array<[string, number]>
    return Object.fromEntries(entries)
  }, [snapshot])
}

export function useTerminalWorktreeOutputActive(terminalWorktreeKey: string | null): boolean {
  const { terminalWorktreeSnapshot, subscribeTerminalWorktree } = useTerminalSessionReadContext()
  const subscribe = useCallback(
    (listener: () => void) =>
      terminalWorktreeKey ? subscribeTerminalWorktree(terminalWorktreeKey, listener) : () => {},
    [terminalWorktreeKey, subscribeTerminalWorktree],
  )
  const getSnapshot = useCallback(
    () => (terminalWorktreeKey ? terminalWorktreeSnapshot(terminalWorktreeKey).outputActiveCount > 0 : false),
    [terminalWorktreeKey, terminalWorktreeSnapshot],
  )
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function useTerminalWorktreeSelectedDescriptor(terminalWorktreeKey: string | null): TerminalDescriptor | null {
  const { terminalWorktreeSnapshot, subscribeTerminalWorktree } = useTerminalSessionReadContext()
  const subscribe = useCallback(
    (listener: () => void) =>
      terminalWorktreeKey ? subscribeTerminalWorktree(terminalWorktreeKey, listener) : () => {},
    [terminalWorktreeKey, subscribeTerminalWorktree],
  )
  const getSnapshot = useCallback(
    () => (terminalWorktreeKey ? terminalWorktreeSnapshot(terminalWorktreeKey).selectedDescriptor : null),
    [terminalWorktreeKey, terminalWorktreeSnapshot],
  )
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function useTerminalSessionSummaries(terminalWorktreeKey: string | null): TerminalSessionSummary[] {
  const { terminalWorktreeSnapshot, subscribeTerminalWorktree } = useTerminalSessionReadContext()
  const subscribe = useCallback(
    (listener: () => void) =>
      terminalWorktreeKey ? subscribeTerminalWorktree(terminalWorktreeKey, listener) : () => {},
    [terminalWorktreeKey, subscribeTerminalWorktree],
  )
  const getSnapshot = useCallback(
    () =>
      terminalWorktreeKey ? terminalWorktreeSnapshot(terminalWorktreeKey).sessions : EMPTY_TERMINAL_SESSION_SUMMARIES,
    [terminalWorktreeKey, terminalWorktreeSnapshot],
  )
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function useTerminalRepoProjectionPhase(repoRoot: string | null): TerminalProjectionHydrationPhase {
  const instanceId = useReposStore((s) => (repoRoot ? s.repos[repoRoot]?.instanceId : undefined))
  return useTerminalProjectionHydrationPhase(repoRoot, instanceId)
}

export function useTerminalRepoProjectionHydrationEntry(repoRoot: string | null): TerminalProjectionHydrationEntry {
  const instanceId = useReposStore((s) => (repoRoot ? s.repos[repoRoot]?.instanceId : undefined))
  return useTerminalProjectionHydrationEntry(repoRoot, instanceId)
}

export function useTerminalRepoProjectionReady(repoRoot: string | null): boolean {
  return useTerminalRepoProjectionPhase(repoRoot) === 'ready'
}

export function useTerminalSnapshot(terminalSessionId: string | null): TerminalSnapshot {
  const { snapshot, subscribeSnapshot } = useTerminalSessionReadContext()
  const subscribe = useCallback(
    (listener: () => void) => (terminalSessionId ? subscribeSnapshot(terminalSessionId, listener) : () => {}),
    [terminalSessionId, subscribeSnapshot],
  )
  const getSnapshot = useCallback(
    () => (terminalSessionId ? snapshot(terminalSessionId) : EMPTY_TERMINAL_SNAPSHOT),
    [terminalSessionId, snapshot],
  )
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
