// Per-repo terminal server-projection hydration state.
//
// Terminal sessions are server-owned runtime state. The client keeps a local
// projection for UI rendering; this store records whether that server ->
// client projection has hydrated for each live repo instance.

import { useMemo } from 'react'
import { create } from 'zustand'

const DEFAULT_REFRESH_COOLDOWN_MS = 2000

export type TerminalProjectionHydrationPhase = 'pending' | 'ready' | 'failed'

export interface TerminalProjectionHydrationEntry {
  instanceId: string
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
  beginProjectionHydration: (repoRoot: string, instanceId: string) => void
  markProjectionReady: (repoRoot: string, instanceId: string) => void
  markProjectionFailed: (repoRoot: string, instanceId: string, errorMessage?: string) => void
  shouldRefreshProjection: (repoRoot: string) => boolean
}

export const useTerminalProjectionHydrationStore = create<TerminalProjectionHydrationState>((set, get) => ({
  refreshCooldownMs: DEFAULT_REFRESH_COOLDOWN_MS,
  hydrationByRepo: new Map(),
  refreshedAtByRepo: new Map(),
  beginProjectionHydration: (repoRoot, instanceId) => {
    const current = get().hydrationByRepo.get(repoRoot)
    if (current?.instanceId === instanceId && current.phase === 'pending') return
    set((s) => {
      const hydrationByRepo = new Map(s.hydrationByRepo)
      hydrationByRepo.set(repoRoot, { instanceId, phase: 'pending' })
      return { hydrationByRepo }
    })
  },
  markProjectionReady: (repoRoot, instanceId) => {
    const current = get().hydrationByRepo.get(repoRoot)
    if (current?.instanceId === instanceId && current.phase === 'ready') return
    set((s) => {
      const hydrationByRepo = new Map(s.hydrationByRepo)
      hydrationByRepo.set(repoRoot, { instanceId, phase: 'ready' })
      const refreshedAtByRepo = new Map(s.refreshedAtByRepo)
      refreshedAtByRepo.set(repoRoot, Date.now())
      return { hydrationByRepo, refreshedAtByRepo }
    })
  },
  markProjectionFailed: (repoRoot, instanceId, errorMessage) => {
    const current = get().hydrationByRepo.get(repoRoot)
    if (current?.instanceId === instanceId && current.phase === 'failed' && current.errorMessage === errorMessage) return
    set((s) => {
      const hydrationByRepo = new Map(s.hydrationByRepo)
      hydrationByRepo.set(repoRoot, { instanceId, phase: 'failed', errorMessage })
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
  instanceId: string | null | undefined,
): TerminalProjectionHydrationPhase {
  return useTerminalProjectionHydrationEntry(repoRoot, instanceId).phase
}

export function useTerminalProjectionHydrationEntry(
  repoRoot: string | null | undefined,
  instanceId: string | null | undefined,
): TerminalProjectionHydrationEntry {
  const hydrationByRepo = useTerminalProjectionHydrationStore((s) => s.hydrationByRepo)
  return useMemo(() => {
    if (!repoRoot || !instanceId) return { instanceId: instanceId ?? '', phase: 'pending' }
    const current = hydrationByRepo.get(repoRoot)
    return current?.instanceId === instanceId ? current : { instanceId, phase: 'pending' }
  }, [hydrationByRepo, instanceId, repoRoot])
}

export function useIsInitialTerminalProjectionHydrating(
  repoRoot: string | null | undefined,
  instanceId: string | null | undefined,
): boolean {
  const hydrationByRepo = useTerminalProjectionHydrationStore((s) => s.hydrationByRepo)
  return useMemo(() => {
    if (!repoRoot || !instanceId) return false
    const current = hydrationByRepo.get(repoRoot)
    return (current?.instanceId === instanceId ? current.phase : 'pending') === 'pending'
  }, [hydrationByRepo, instanceId, repoRoot])
}
