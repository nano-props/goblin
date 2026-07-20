// Per-workspace terminal server-projection hydration state.
//
// Terminal sessions are server-owned runtime state. The client keeps a local
// projection for UI rendering; this store records whether that server ->
// client projection has hydrated for each live workspace runtime.

import { useMemo } from 'react'
import { create } from 'zustand'
import type { WorkspacePaneRuntimeProjectionPhase } from '#/web/workspace-pane/workspace-pane-runtime-state.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

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
  /** workspaceId -> hydration state for the current terminal projection runtime. */
  hydrationByWorkspace: Map<string, TerminalProjectionHydrationEntry>
  /** workspaceId -> ms-since-epoch recorded by the latest successful projection hydrate. */
  refreshedAtByWorkspace: Map<string, number>
  beginProjectionHydration: (workspaceId: WorkspaceId, workspaceRuntimeId: string) => void
  markProjectionReady: (workspaceId: WorkspaceId, workspaceRuntimeId: string) => void
  markProjectionFailed: (workspaceId: WorkspaceId, workspaceRuntimeId: string, errorMessage?: string) => void
  shouldRefreshProjection: (workspaceId: WorkspaceId) => boolean
}

export const useTerminalProjectionHydrationStore = create<TerminalProjectionHydrationState>((set, get) => ({
  refreshCooldownMs: DEFAULT_REFRESH_COOLDOWN_MS,
  hydrationByWorkspace: new Map(),
  refreshedAtByWorkspace: new Map(),
  beginProjectionHydration: (workspaceId, workspaceRuntimeId) => {
    const current = get().hydrationByWorkspace.get(workspaceId)
    if (current?.workspaceRuntimeId === workspaceRuntimeId && current.phase === 'pending') return
    set((s) => {
      const hydrationByWorkspace = new Map(s.hydrationByWorkspace)
      hydrationByWorkspace.set(workspaceId, { workspaceRuntimeId, phase: 'pending' })
      return { hydrationByWorkspace }
    })
  },
  markProjectionReady: (workspaceId, workspaceRuntimeId) => {
    const current = get().hydrationByWorkspace.get(workspaceId)
    if (current?.workspaceRuntimeId === workspaceRuntimeId && current.phase === 'ready') return
    set((s) => {
      const hydrationByWorkspace = new Map(s.hydrationByWorkspace)
      hydrationByWorkspace.set(workspaceId, { workspaceRuntimeId, phase: 'ready' })
      const refreshedAtByWorkspace = new Map(s.refreshedAtByWorkspace)
      refreshedAtByWorkspace.set(workspaceId, Date.now())
      return { hydrationByWorkspace, refreshedAtByWorkspace }
    })
  },
  markProjectionFailed: (workspaceId, workspaceRuntimeId, errorMessage) => {
    const current = get().hydrationByWorkspace.get(workspaceId)
    if (
      current?.workspaceRuntimeId === workspaceRuntimeId &&
      current.phase === 'failed' &&
      current.errorMessage === errorMessage
    )
      return
    set((s) => {
      const hydrationByWorkspace = new Map(s.hydrationByWorkspace)
      hydrationByWorkspace.set(workspaceId, { workspaceRuntimeId, phase: 'failed', errorMessage })
      return { hydrationByWorkspace }
    })
  },
  shouldRefreshProjection: (workspaceId) => {
    const last = get().refreshedAtByWorkspace.get(workspaceId) ?? 0
    return Date.now() - last >= get().refreshCooldownMs
  },
}))

export function useTerminalProjectionHydrationPhase(
  workspaceId: WorkspaceId | null | undefined,
  workspaceRuntimeId: string | null | undefined,
): TerminalProjectionHydrationPhase {
  return useTerminalProjectionHydrationEntry(workspaceId, workspaceRuntimeId).phase
}

export function useTerminalProjectionHydrationEntry(
  workspaceId: WorkspaceId | null | undefined,
  workspaceRuntimeId: string | null | undefined,
): TerminalProjectionHydrationEntry {
  const hydrationByWorkspace = useTerminalProjectionHydrationStore((s) => s.hydrationByWorkspace)
  return useMemo(() => {
    if (!workspaceId || !workspaceRuntimeId) return { workspaceRuntimeId: workspaceRuntimeId ?? '', phase: 'pending' }
    const current = hydrationByWorkspace.get(workspaceId)
    return current?.workspaceRuntimeId === workspaceRuntimeId ? current : { workspaceRuntimeId, phase: 'pending' }
  }, [hydrationByWorkspace, workspaceRuntimeId, workspaceId])
}

export function useIsInitialTerminalProjectionHydrating(
  workspaceId: WorkspaceId | null | undefined,
  workspaceRuntimeId: string | null | undefined,
): boolean {
  const hydrationByWorkspace = useTerminalProjectionHydrationStore((s) => s.hydrationByWorkspace)
  return useMemo(() => {
    if (!workspaceId || !workspaceRuntimeId) return false
    const current = hydrationByWorkspace.get(workspaceId)
    return (current?.workspaceRuntimeId === workspaceRuntimeId ? current.phase : 'pending') === 'pending'
  }, [hydrationByWorkspace, workspaceRuntimeId, workspaceId])
}
