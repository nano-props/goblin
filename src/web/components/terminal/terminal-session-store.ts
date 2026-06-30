import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { useTerminalSessionReadContext } from '#/web/components/terminal/terminal-session-context.ts'
import { useRepoSyncStore } from '#/web/stores/repo-sync.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type {
  TerminalWorktreeSnapshot,
  TerminalSnapshot,
  TerminalDescriptor,
  TerminalSessionSummary,
} from '#/web/components/terminal/types.ts'

const EMPTY_WORKTREE_TERMINAL_SNAPSHOT: TerminalWorktreeSnapshot = {
  terminalWorktreeKey: '',
  selectedDescriptor: null,
  sessions: [],
  count: 0,
  bellCount: 0,
  activeCount: 0,
  pendingCreate: false,
}

const EMPTY_TERMINAL_SNAPSHOT: TerminalSnapshot = { phase: 'opening', message: null, processName: 'terminal' }

export function useTerminalWorktreeSnapshot(terminalWorktreeKey: string | null): TerminalWorktreeSnapshot {
  const { terminalWorktreeSnapshot, subscribeTerminalWorktree } = useTerminalSessionReadContext()
  const subscribe = useCallback(
    (listener: () => void) =>
      terminalWorktreeKey ? subscribeTerminalWorktree(terminalWorktreeKey, listener) : () => {},
    [terminalWorktreeKey, subscribeTerminalWorktree],
  )
  const getSnapshot = useCallback(
    () => (terminalWorktreeKey ? terminalWorktreeSnapshot(terminalWorktreeKey) : EMPTY_WORKTREE_TERMINAL_SNAPSHOT),
    [terminalWorktreeKey, terminalWorktreeSnapshot],
  )
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

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

export function useTerminalWorktreePendingCreate(terminalWorktreeKey: string | null): boolean {
  const { terminalWorktreeSnapshot, subscribeTerminalWorktree } = useTerminalSessionReadContext()
  const subscribe = useCallback(
    (listener: () => void) =>
      terminalWorktreeKey ? subscribeTerminalWorktree(terminalWorktreeKey, listener) : () => {},
    [terminalWorktreeKey, subscribeTerminalWorktree],
  )
  const getSnapshot = useCallback(
    () => (terminalWorktreeKey ? terminalWorktreeSnapshot(terminalWorktreeKey).pendingCreate : false),
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

export function useTerminalWorktreeActive(terminalWorktreeKey: string | null): boolean {
  const { terminalWorktreeSnapshot, subscribeTerminalWorktree } = useTerminalSessionReadContext()
  const subscribe = useCallback(
    (listener: () => void) =>
      terminalWorktreeKey ? subscribeTerminalWorktree(terminalWorktreeKey, listener) : () => {},
    [terminalWorktreeKey, subscribeTerminalWorktree],
  )
  const getSnapshot = useCallback(
    () => (terminalWorktreeKey ? terminalWorktreeSnapshot(terminalWorktreeKey).activeCount > 0 : false),
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
    () => (terminalWorktreeKey ? terminalWorktreeSnapshot(terminalWorktreeKey).sessions : []),
    [terminalWorktreeKey, terminalWorktreeSnapshot],
  )
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function useTerminalRepoSyncReady(repoRoot: string | null): boolean {
  const instanceToken = useReposStore((s) => (repoRoot ? s.repos[repoRoot]?.instanceToken : undefined))
  return useRepoSyncStore((s) => {
    if (!repoRoot || typeof instanceToken !== 'number') return false
    return s.ready.get(repoRoot) === instanceToken
  })
}

export function useTerminalSnapshot(terminalKey: string | null): TerminalSnapshot {
  const { snapshot, subscribeSnapshot } = useTerminalSessionReadContext()
  const subscribe = useCallback(
    (listener: () => void) => (terminalKey ? subscribeSnapshot(terminalKey, listener) : () => {}),
    [terminalKey, subscribeSnapshot],
  )
  const getSnapshot = useCallback(
    () => (terminalKey ? snapshot(terminalKey) : EMPTY_TERMINAL_SNAPSHOT),
    [terminalKey, snapshot],
  )
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
