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
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import type {
  TerminalSnapshot,
  TerminalDescriptor,
  TerminalSessionSummary,
  TerminalWorktreeSnapshot,
} from '#/web/components/terminal/types.ts'
import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import { terminalDescriptor } from '#/web/components/terminal/terminal-descriptor.ts'

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
  const getSnapshot = useCallback((): T => {
    const snap = terminalWorktreeKey
      ? ctx.terminalWorktreeSnapshot(terminalWorktreeKey)
      : EMPTY_TERMINAL_WORKTREE_SNAPSHOT
    return selectorRef.current(snap)
  }, [ctx, terminalWorktreeKey])
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
  const getSnapshot = useCallback((): T => {
    const snap = terminalSessionId ? ctx.snapshot(terminalSessionId) : EMPTY_TERMINAL_SNAPSHOT
    return selectorRef.current(snap)
  }, [ctx, terminalSessionId])
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

export function useWorkspaceTerminalBellCounts(workspaceIds: readonly string[]): Record<string, number> {
  const { workspaceBellCount, subscribeWorkspaceBellCount } = useTerminalSessionReadContext()
  const subscribe = useCallback(
    (listener: () => void) => {
      const uniqueWorkspaceIds = Array.from(new Set(workspaceIds))
      if (uniqueWorkspaceIds.length === 0) return () => {}
      const unsubscribe = uniqueWorkspaceIds.map((workspaceId) => subscribeWorkspaceBellCount(workspaceId, listener))
      return () => {
        for (const off of unsubscribe) off()
      }
    },
    [workspaceIds, subscribeWorkspaceBellCount],
  )
  const getSnapshot = useCallback(() => {
    return JSON.stringify(workspaceIds.map((workspaceId) => [workspaceId, workspaceBellCount(workspaceId)] as const))
  }, [workspaceIds, workspaceBellCount])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return useMemo(() => {
    const entries = JSON.parse(snapshot) as Array<[string, number]>
    return Object.fromEntries(entries)
  }, [snapshot])
}

export function useTerminalWorktreeOutputActive(terminalWorktreeKey: string | null): boolean {
  return useTerminalWorktreeField(terminalWorktreeKey, (s) => s.outputActiveCount > 0)
}

export function useTerminalWorktreeSelectedDescriptor(terminalWorktreeKey: string | null): TerminalDescriptor | null {
  return useTerminalWorktreeField(terminalWorktreeKey, (s) => s.selectedDescriptor)
}

const MISSING_TERMINAL_DESCRIPTOR_SNAPSHOT = ''

export function useTerminalWorktreeSessionDescriptor({
  terminalWorktreeKey,
  terminalSessionId,
  base,
}: {
  terminalWorktreeKey: string | null
  terminalSessionId: string | null
  base: TerminalSessionBase
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
    return terminalDescriptor(base, snapshotTerminalSessionId, Number(indexText) || 0)
  }, [base, descriptorSnapshot, terminalWorktreeKey])
}

export function useTerminalSessionSummaries(terminalWorktreeKey: string | null): TerminalSessionSummary[] {
  return useTerminalWorktreeField(terminalWorktreeKey, (s) => s.sessions)
}

export function useTerminalWorkspaceProjectionPhase(workspaceId: string | null): TerminalProjectionHydrationPhase {
  const workspaceRuntimeId = useWorkspacesStore((s) =>
    workspaceId ? s.workspaces[workspaceId]?.workspaceRuntimeId : undefined,
  )
  return useTerminalProjectionHydrationPhase(workspaceId, workspaceRuntimeId)
}

export function useTerminalWorkspaceProjectionHydrationEntry(workspaceId: string | null): TerminalProjectionHydrationEntry {
  const workspaceRuntimeId = useWorkspacesStore((s) =>
    workspaceId ? s.workspaces[workspaceId]?.workspaceRuntimeId : undefined,
  )
  return useTerminalProjectionHydrationEntry(workspaceId, workspaceRuntimeId)
}

export function useTerminalWorkspaceProjectionReady(workspaceId: string | null): boolean {
  return useTerminalWorkspaceProjectionPhase(workspaceId) === 'ready'
}

export function useTerminalSnapshot(terminalSessionId: string | null): TerminalSnapshot {
  return useTerminalSessionField(terminalSessionId, (s) => s)
}
