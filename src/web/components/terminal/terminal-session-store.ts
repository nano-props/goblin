import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react'
import {
  EMPTY_TERMINAL_SNAPSHOT,
  EMPTY_TERMINAL_WORKTREE_SNAPSHOT,
  useTerminalSessionReadContext,
} from '#/web/components/terminal/terminal-session-context.ts'
import {
  useTerminalProjectionHydrationEntry,
  useTerminalProjectionHydrationPhase,
  type TerminalProjectionHydrationEntry,
  type TerminalProjectionHydrationPhase,
} from '#/web/stores/terminal-projection-hydration.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type {
  TerminalSnapshot,
  TerminalDescriptor,
  TerminalSessionSummary,
  TerminalWorktreeSnapshot,
} from '#/web/components/terminal/types.ts'

/**
 * Subscribe to a derived field of a single worktree's snapshot. The selector
 * is captured via a ref so callers can pass an inline function without
 * `useCallback`, while `subscribe` / `getSnapshot` stay referentially stable
 * (required by `useSyncExternalStore`).
 *
 * Exported so callers can compose custom derived hooks without rebuilding
 * the subscribe/getSnapshot plumbing, and so tests can verify the
 * latest-ref pattern in isolation.
 */
export function useTerminalWorktreeField<T>(
  terminalWorktreeKey: string | null,
  selector: (snapshot: TerminalWorktreeSnapshot) => T,
): T {
  const ctx = useTerminalSessionReadContext()
  const selectorRef = useRef(selector)
  selectorRef.current = selector

  const subscribe = useCallback(
    (listener: () => void): (() => void) =>
      terminalWorktreeKey ? ctx.subscribeTerminalWorktree(terminalWorktreeKey, listener) : () => {},
    [ctx, terminalWorktreeKey],
  )
  const getSnapshot = useCallback(
    (): T => {
      const snap = terminalWorktreeKey
        ? ctx.terminalWorktreeSnapshot(terminalWorktreeKey)
        : EMPTY_TERMINAL_WORKTREE_SNAPSHOT
      return selectorRef.current(snap)
    },
    [ctx, terminalWorktreeKey],
  )
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/**
 * Subscribe to a derived field of a single session's snapshot. Same
 * selectorRef pattern as `useTerminalWorktreeField`.
 */
export function useTerminalSessionField<T>(
  terminalSessionId: string | null,
  selector: (snapshot: TerminalSnapshot) => T,
): T {
  const ctx = useTerminalSessionReadContext()
  const selectorRef = useRef(selector)
  selectorRef.current = selector

  const subscribe = useCallback(
    (listener: () => void): (() => void) =>
      terminalSessionId ? ctx.subscribeSnapshot(terminalSessionId, listener) : () => {},
    [ctx, terminalSessionId],
  )
  const getSnapshot = useCallback(
    (): T => {
      const snap = terminalSessionId ? ctx.snapshot(terminalSessionId) : EMPTY_TERMINAL_SNAPSHOT
      return selectorRef.current(snap)
    },
    [ctx, terminalSessionId],
  )
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function useTerminalWorktreeCount(terminalWorktreeKey: string | null): number {
  return useTerminalWorktreeField(terminalWorktreeKey, (s) => s.count)
}

export function useTerminalWorktreeCreatePending(terminalWorktreeKey: string | null): boolean {
  return useTerminalWorktreeField(terminalWorktreeKey, (s) => s.createPending)
}

export function useTerminalWorktreeBellCount(terminalWorktreeKey: string | null): number {
  return useTerminalWorktreeField(terminalWorktreeKey, (s) => s.bellCount)
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
  return useTerminalWorktreeField(terminalWorktreeKey, (s) => s.outputActiveCount > 0)
}

export function useTerminalWorktreeSelectedDescriptor(
  terminalWorktreeKey: string | null,
): TerminalDescriptor | null {
  return useTerminalWorktreeField(terminalWorktreeKey, (s) => s.selectedDescriptor)
}

const MISSING_TERMINAL_DESCRIPTOR_SNAPSHOT = ''

export function useTerminalWorktreeSessionDescriptor({
  terminalWorktreeKey,
  terminalSessionId,
  repoRoot,
  repoRuntimeId,
  branch,
  worktreePath,
}: {
  terminalWorktreeKey: string | null
  terminalSessionId: string | null
  repoRoot: string
  repoRuntimeId: string
  branch: string
  worktreePath: string
}): TerminalDescriptor | null {
  const { terminalWorktreeSnapshot, subscribeTerminalWorktree } = useTerminalSessionReadContext()
  const subscribe = useCallback(
    (listener: () => void) =>
      terminalWorktreeKey && terminalSessionId ? subscribeTerminalWorktree(terminalWorktreeKey, listener) : () => {},
    [terminalSessionId, terminalWorktreeKey, subscribeTerminalWorktree],
  )
  const getSnapshot = useCallback(() => {
    if (!terminalWorktreeKey || !terminalSessionId) return MISSING_TERMINAL_DESCRIPTOR_SNAPSHOT
    const session = terminalWorktreeSnapshot(terminalWorktreeKey).sessions.find(
      (candidate) => candidate.terminalSessionId === terminalSessionId,
    )
    return session ? `${session.terminalSessionId}\0${session.index}` : MISSING_TERMINAL_DESCRIPTOR_SNAPSHOT
  }, [terminalSessionId, terminalWorktreeKey, terminalWorktreeSnapshot])
  const descriptorSnapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return useMemo(() => {
    if (!terminalWorktreeKey || !descriptorSnapshot) return null
    const [snapshotTerminalSessionId, indexText] = descriptorSnapshot.split('\0')
    if (!snapshotTerminalSessionId) return null
    return {
      terminalWorktreeKey,
      terminalSessionId: snapshotTerminalSessionId,
      index: Number(indexText) || 0,
      repoRoot,
      repoRuntimeId,
      branch,
      worktreePath,
    }
  }, [branch, descriptorSnapshot, repoRuntimeId, repoRoot, terminalWorktreeKey, worktreePath])
}

export function useTerminalSessionSummaries(terminalWorktreeKey: string | null): TerminalSessionSummary[] {
  return useTerminalWorktreeField(terminalWorktreeKey, (s) => s.sessions)
}

export function useTerminalRepoProjectionPhase(repoRoot: string | null): TerminalProjectionHydrationPhase {
  const repoRuntimeId = useReposStore((s) => (repoRoot ? s.repos[repoRoot]?.repoRuntimeId : undefined))
  return useTerminalProjectionHydrationPhase(repoRoot, repoRuntimeId)
}

export function useTerminalRepoProjectionHydrationEntry(repoRoot: string | null): TerminalProjectionHydrationEntry {
  const repoRuntimeId = useReposStore((s) => (repoRoot ? s.repos[repoRoot]?.repoRuntimeId : undefined))
  return useTerminalProjectionHydrationEntry(repoRoot, repoRuntimeId)
}

export function useTerminalRepoProjectionReady(repoRoot: string | null): boolean {
  return useTerminalRepoProjectionPhase(repoRoot) === 'ready'
}

export function useTerminalSnapshot(terminalSessionId: string | null): TerminalSnapshot {
  return useTerminalSessionField(terminalSessionId, (s) => s)
}