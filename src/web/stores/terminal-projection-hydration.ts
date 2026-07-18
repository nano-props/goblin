// Per-repo terminal server-projection hydration state.
//
// Terminal sessions are server-owned runtime state. The client keeps a local
// projection for UI rendering; this store records whether that server ->
// client projection has hydrated for each live workspace runtime.

import { useMemo } from 'react'
import { create } from 'zustand'
import type { WorkspacePaneRuntimeProjectionPhase } from '#/web/workspace-pane/workspace-pane-runtime-state.ts'

const DEFAULT_REFRESH_COOLDOWN_MS = 2000

export type TerminalProjectionHydrationPhase = WorkspacePaneRuntimeProjectionPhase

export interface TerminalProjectionHydrationEntry {
  workspaceRuntimeId: string
  phase: TerminalProjectionHydrationPhase
  errorMessage?: string
}

interface TerminalProjectionHydrationState {
  /** Minimum gap between focus-triggered projection refreshes. */
  refreshCooldownMs: number
  /** repoRoot -> hydration state for the current terminal projection runtime. */
  hydrationByRepo: Map<string, TerminalProjectionHydrationEntry>
  /** repoRoot -> ms-since-epoch recorded by the latest successful projection hydrate. */
  refreshedAtByRepo: Map<string, number>
  beginProjectionHydration: (repoRoot: string, workspaceRuntimeId: string) => void
  markProjectionReady: (repoRoot: string, workspaceRuntimeId: string) => void
  markProjectionFailed: (repoRoot: string, workspaceRuntimeId: string, errorMessage?: string) => void
  shouldRefreshProjection: (repoRoot: string) => boolean
}

export const useTerminalProjectionHydrationStore = create<TerminalProjectionHydrationState>((set, get) => ({
  refreshCooldownMs: DEFAULT_REFRESH_COOLDOWN_MS,
  hydrationByRepo: new Map(),
  refreshedAtByRepo: new Map(),
  beginProjectionHydration: (repoRoot, workspaceRuntimeId) => {
    const current = get().hydrationByRepo.get(repoRoot)
    if (current?.workspaceRuntimeId === workspaceRuntimeId && current.phase === 'pending') return
    set((s) => {
      const hydrationByRepo = new Map(s.hydrationByRepo)
      hydrationByRepo.set(repoRoot, { workspaceRuntimeId, phase: 'pending' })
      return { hydrationByRepo }
    })
  },
  markProjectionReady: (repoRoot, workspaceRuntimeId) => {
    const current = get().hydrationByRepo.get(repoRoot)
    if (current?.workspaceRuntimeId === workspaceRuntimeId && current.phase === 'ready') return
    set((s) => {
      const hydrationByRepo = new Map(s.hydrationByRepo)
      hydrationByRepo.set(repoRoot, { workspaceRuntimeId, phase: 'ready' })
      const refreshedAtByRepo = new Map(s.refreshedAtByRepo)
      refreshedAtByRepo.set(repoRoot, Date.now())
      return { hydrationByRepo, refreshedAtByRepo }
    })
  },
  markProjectionFailed: (repoRoot, workspaceRuntimeId, errorMessage) => {
    const current = get().hydrationByRepo.get(repoRoot)
    if (
      current?.workspaceRuntimeId === workspaceRuntimeId &&
      current.phase === 'failed' &&
      current.errorMessage === errorMessage
    )
      return
    set((s) => {
      const hydrationByRepo = new Map(s.hydrationByRepo)
      hydrationByRepo.set(repoRoot, { workspaceRuntimeId, phase: 'failed', errorMessage })
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
  workspaceRuntimeId: string | null | undefined,
): TerminalProjectionHydrationPhase {
  return useTerminalProjectionHydrationEntry(repoRoot, workspaceRuntimeId).phase
}

export function useTerminalProjectionHydrationEntry(
  repoRoot: string | null | undefined,
  workspaceRuntimeId: string | null | undefined,
): TerminalProjectionHydrationEntry {
  const hydrationByRepo = useTerminalProjectionHydrationStore((s) => s.hydrationByRepo)
  return useMemo(() => {
    if (!repoRoot || !workspaceRuntimeId) return { workspaceRuntimeId: workspaceRuntimeId ?? '', phase: 'pending' }
    const current = hydrationByRepo.get(repoRoot)
    return current?.workspaceRuntimeId === workspaceRuntimeId ? current : { workspaceRuntimeId, phase: 'pending' }
  }, [hydrationByRepo, workspaceRuntimeId, repoRoot])
}

export function useIsInitialTerminalProjectionHydrating(
  repoRoot: string | null | undefined,
  workspaceRuntimeId: string | null | undefined,
): boolean {
  const hydrationByRepo = useTerminalProjectionHydrationStore((s) => s.hydrationByRepo)
  return useMemo(() => {
    if (!repoRoot || !workspaceRuntimeId) return false
    const current = hydrationByRepo.get(repoRoot)
    return (current?.workspaceRuntimeId === workspaceRuntimeId ? current.phase : 'pending') === 'pending'
  }, [hydrationByRepo, workspaceRuntimeId, repoRoot])
}
