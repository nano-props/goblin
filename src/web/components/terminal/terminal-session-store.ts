import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { useTerminalSessionReadContext } from '#/web/components/terminal/terminal-session-context.ts'
import { useRepoSyncStore } from '#/web/stores/repo-sync.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type {
  WorktreeTerminalSnapshot,
  TerminalSnapshot,
  TerminalDescriptor,
  TerminalSessionSummary,
} from '#/web/components/terminal/types.ts'

const EMPTY_WORKTREE_TERMINAL_SNAPSHOT: WorktreeTerminalSnapshot = {
  worktreeTerminalKey: '',
  selectedDescriptor: null,
  sessions: [],
  count: 0,
  bellCount: 0,
  pendingCreate: false,
}

const EMPTY_TERMINAL_SNAPSHOT: TerminalSnapshot = { phase: 'opening', message: null, processName: 'terminal' }

export function useWorktreeTerminalSnapshot(worktreeTerminalKey: string | null): WorktreeTerminalSnapshot {
  const { worktreeSnapshot, subscribeWorktree } = useTerminalSessionReadContext()
  const subscribe = useCallback(
    (listener: () => void) => (worktreeTerminalKey ? subscribeWorktree(worktreeTerminalKey, listener) : () => {}),
    [worktreeTerminalKey, subscribeWorktree],
  )
  const getSnapshot = useCallback(
    () => (worktreeTerminalKey ? worktreeSnapshot(worktreeTerminalKey) : EMPTY_WORKTREE_TERMINAL_SNAPSHOT),
    [worktreeTerminalKey, worktreeSnapshot],
  )
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function useWorktreeTerminalCount(worktreeTerminalKey: string | null): number {
  const { worktreeSnapshot, subscribeWorktree } = useTerminalSessionReadContext()
  const subscribe = useCallback(
    (listener: () => void) => (worktreeTerminalKey ? subscribeWorktree(worktreeTerminalKey, listener) : () => {}),
    [worktreeTerminalKey, subscribeWorktree],
  )
  const getSnapshot = useCallback(
    () => (worktreeTerminalKey ? worktreeSnapshot(worktreeTerminalKey).count : 0),
    [worktreeTerminalKey, worktreeSnapshot],
  )
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function useWorktreeTerminalPendingCreate(worktreeTerminalKey: string | null): boolean {
  const { worktreeSnapshot, subscribeWorktree } = useTerminalSessionReadContext()
  const subscribe = useCallback(
    (listener: () => void) => (worktreeTerminalKey ? subscribeWorktree(worktreeTerminalKey, listener) : () => {}),
    [worktreeTerminalKey, subscribeWorktree],
  )
  const getSnapshot = useCallback(
    () => (worktreeTerminalKey ? worktreeSnapshot(worktreeTerminalKey).pendingCreate : false),
    [worktreeTerminalKey, worktreeSnapshot],
  )
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function useWorktreeTerminalBellCount(worktreeTerminalKey: string | null): number {
  const { worktreeSnapshot, subscribeWorktree } = useTerminalSessionReadContext()
  const subscribe = useCallback(
    (listener: () => void) => (worktreeTerminalKey ? subscribeWorktree(worktreeTerminalKey, listener) : () => {}),
    [worktreeTerminalKey, subscribeWorktree],
  )
  const getSnapshot = useCallback(
    () => (worktreeTerminalKey ? worktreeSnapshot(worktreeTerminalKey).bellCount : 0),
    [worktreeTerminalKey, worktreeSnapshot],
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

export function useWorktreeTerminalSelectedDescriptor(worktreeTerminalKey: string | null): TerminalDescriptor | null {
  const { worktreeSnapshot, subscribeWorktree } = useTerminalSessionReadContext()
  const subscribe = useCallback(
    (listener: () => void) => (worktreeTerminalKey ? subscribeWorktree(worktreeTerminalKey, listener) : () => {}),
    [worktreeTerminalKey, subscribeWorktree],
  )
  const getSnapshot = useCallback(
    () => (worktreeTerminalKey ? worktreeSnapshot(worktreeTerminalKey).selectedDescriptor : null),
    [worktreeTerminalKey, worktreeSnapshot],
  )
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function useTerminalSessionSummaries(worktreeTerminalKey: string | null): TerminalSessionSummary[] {
  const { worktreeSnapshot, subscribeWorktree } = useTerminalSessionReadContext()
  const subscribe = useCallback(
    (listener: () => void) => (worktreeTerminalKey ? subscribeWorktree(worktreeTerminalKey, listener) : () => {}),
    [worktreeTerminalKey, subscribeWorktree],
  )
  const getSnapshot = useCallback(
    () => (worktreeTerminalKey ? worktreeSnapshot(worktreeTerminalKey).sessions : []),
    [worktreeTerminalKey, worktreeSnapshot],
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

export function useTerminalSnapshot(key: string | null): TerminalSnapshot {
  const { snapshot, subscribeSnapshot } = useTerminalSessionReadContext()
  const subscribe = useCallback(
    (listener: () => void) => (key ? subscribeSnapshot(key, listener) : () => {}),
    [key, subscribeSnapshot],
  )
  const getSnapshot = useCallback(() => (key ? snapshot(key) : EMPTY_TERMINAL_SNAPSHOT), [key, snapshot])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
