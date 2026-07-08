// Per-repo terminal server-projection hydration state.
//
// Terminal sessions are server-owned runtime state. The client keeps a local
// projection for UI rendering; this store records whether that server ->
// client projection has hydrated for each live repo runtime.

import { useMemo } from 'react'
import { create } from 'zustand'
import type { WorkspacePaneRuntimeProjectionPhase } from '#/web/workspace-pane/workspace-pane-runtime-state.ts'

const DEFAULT_REFRESH_COOLDOWN_MS = 2000

export type TerminalProjectionHydrationPhase = WorkspacePaneRuntimeProjectionPhase

export interface TerminalProjectionHydrationEntry {
  repoRuntimeId: string
  phase: TerminalProjectionHydrationPhase
  errorMessage?: string
}

interface TerminalProjectionHydrationState {
  /** Minimum gap between focus-triggered projection refreshes. */
  refreshCooldownMs: number
  /** repoRoot -> hydration state for the current terminal projection instance. */
  hydrationByRepo: Map<string, TerminalProjectionHydrationEntry>
  /** repoRoot -> ms-since-epoch recorded by the latest successful projection hydrate. */
  refreshedAtByRepo: Map<string, number>
  beginProjectionHydration: (repoRoot: string, repoRuntimeId: string) => void
  markProjectionReady: (repoRoot: string, repoRuntimeId: string) => void
  markProjectionFailed: (repoRoot: string, repoRuntimeId: string, errorMessage?: string) => void
  shouldRefreshProjection: (repoRoot: string) => boolean
}

export const useTerminalProjectionHydrationStore = create<TerminalProjectionHydrationState>((set, get) => ({
  refreshCooldownMs: DEFAULT_REFRESH_COOLDOWN_MS,
  hydrationByRepo: new Map(),
  refreshedAtByRepo: new Map(),
  beginProjectionHydration: (repoRoot, repoRuntimeId) => {
    const current = get().hydrationByRepo.get(repoRoot)
    if (current?.repoRuntimeId === repoRuntimeId && current.phase === 'pending') return
    set((s) => {
      const hydrationByRepo = new Map(s.hydrationByRepo)
      hydrationByRepo.set(repoRoot, { repoRuntimeId, phase: 'pending' })
      return { hydrationByRepo }
    })
  },
  markProjectionReady: (repoRoot, repoRuntimeId) => {
    const current = get().hydrationByRepo.get(repoRoot)
    if (current?.repoRuntimeId === repoRuntimeId && current.phase === 'ready') return
    set((s) => {
      const hydrationByRepo = new Map(s.hydrationByRepo)
      hydrationByRepo.set(repoRoot, { repoRuntimeId, phase: 'ready' })
      const refreshedAtByRepo = new Map(s.refreshedAtByRepo)
      refreshedAtByRepo.set(repoRoot, Date.now())
      return { hydrationByRepo, refreshedAtByRepo }
    })
  },
  markProjectionFailed: (repoRoot, repoRuntimeId, errorMessage) => {
    const current = get().hydrationByRepo.get(repoRoot)
    if (current?.repoRuntimeId === repoRuntimeId && current.phase === 'failed' && current.errorMessage === errorMessage)
      return
    set((s) => {
      const hydrationByRepo = new Map(s.hydrationByRepo)
      hydrationByRepo.set(repoRoot, { repoRuntimeId, phase: 'failed', errorMessage })
      return { hydrationByRepo }
    })
  },
  shouldRefreshProjection: (repoRoot) => {
    const last = get().refreshedAtByRepo.get(repoRoot) ?? 0
    return Date.now() - last >= get().refreshCooldownMs
  },
}))

export function useTerminalProjectionHydrationPhase(
  repoRoot: string | null | undefined,
  repoRuntimeId: string | null | undefined,
): TerminalProjectionHydrationPhase {
  return useTerminalProjectionHydrationEntry(repoRoot, repoRuntimeId).phase
}

export function useTerminalProjectionHydrationEntry(
  repoRoot: string | null | undefined,
  repoRuntimeId: string | null | undefined,
): TerminalProjectionHydrationEntry {
  const hydrationByRepo = useTerminalProjectionHydrationStore((s) => s.hydrationByRepo)
  return useMemo(() => {
    if (!repoRoot || !repoRuntimeId) return { repoRuntimeId: repoRuntimeId ?? '', phase: 'pending' }
    const current = hydrationByRepo.get(repoRoot)
    return current?.repoRuntimeId === repoRuntimeId ? current : { repoRuntimeId, phase: 'pending' }
  }, [hydrationByRepo, repoRuntimeId, repoRoot])
}

export function useIsInitialTerminalProjectionHydrating(
  repoRoot: string | null | undefined,
  repoRuntimeId: string | null | undefined,
): boolean {
  const hydrationByRepo = useTerminalProjectionHydrationStore((s) => s.hydrationByRepo)
  return useMemo(() => {
    if (!repoRoot || !repoRuntimeId) return false
    const current = hydrationByRepo.get(repoRoot)
    return (current?.repoRuntimeId === repoRuntimeId ? current.phase : 'pending') === 'pending'
  }, [hydrationByRepo, repoRuntimeId, repoRoot])
}
