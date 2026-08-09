// Per-workspace terminal server-projection hydration state.
//
// Terminal sessions are server-owned runtime state. The client keeps a local
// projection for UI rendering; this store records whether that server ->
// client projection has hydrated for each live workspace runtime.

import { computed, toValue } from 'vue'
import type { ComputedRef, MaybeRefOrGetter } from 'vue'
import { createStore } from 'zustand/vanilla'
import type { WorkspacePaneRuntimeProjectionPhase } from '#/web/workspace-pane/workspace-pane-runtime-state.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { useStoreSelector } from '#/web/stores/store-selector.ts'

const DEFAULT_REFRESH_COOLDOWN_MS = 2000

export type TerminalProjectionHydrationPhase = WorkspacePaneRuntimeProjectionPhase

export interface TerminalProjectionHydrationEntry {
  workspaceRuntimeId: string
  phase: TerminalProjectionHydrationPhase
  errorMessage?: string
}

interface TerminalProjectionSuccessfulRecovery {
  workspaceRuntimeId: string
  completedAt: number
}

interface TerminalProjectionHydrationState {
  /** Minimum gap between focus-triggered projection refreshes. */
  refreshCooldownMs: number
  /** workspaceId -> hydration state for the current terminal projection runtime. */
  hydrationByWorkspace: Map<string, TerminalProjectionHydrationEntry>
  /** workspaceId -> latest accepted recovery for a specific runtime epoch. */
  lastSuccessfulRecoveryByWorkspace: Map<string, TerminalProjectionSuccessfulRecovery>
  beginProjectionHydration: (workspaceId: WorkspaceId, workspaceRuntimeId: string) => void
  markProjectionReady: (workspaceId: WorkspaceId, workspaceRuntimeId: string) => void
  markProjectionFailed: (workspaceId: WorkspaceId, workspaceRuntimeId: string, errorMessage?: string) => void
  isProjectionFocusRefreshDue: (workspaceId: WorkspaceId, workspaceRuntimeId: string) => boolean
}

export const terminalProjectionHydrationStore = createStore<TerminalProjectionHydrationState>((set, get) => ({
  refreshCooldownMs: DEFAULT_REFRESH_COOLDOWN_MS,
  hydrationByWorkspace: new Map(),
  lastSuccessfulRecoveryByWorkspace: new Map(),
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
    set((s) => {
      const hydrationByWorkspace = new Map(s.hydrationByWorkspace)
      hydrationByWorkspace.set(workspaceId, { workspaceRuntimeId, phase: 'ready' })
      const lastSuccessfulRecoveryByWorkspace = new Map(s.lastSuccessfulRecoveryByWorkspace)
      lastSuccessfulRecoveryByWorkspace.set(workspaceId, { workspaceRuntimeId, completedAt: Date.now() })
      return { hydrationByWorkspace, lastSuccessfulRecoveryByWorkspace }
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
  isProjectionFocusRefreshDue: (workspaceId, workspaceRuntimeId) => {
    const state = get()
    const lastSuccessfulRecovery = state.lastSuccessfulRecoveryByWorkspace.get(workspaceId)
    if (lastSuccessfulRecovery?.workspaceRuntimeId !== workspaceRuntimeId) return true
    return Date.now() - lastSuccessfulRecovery.completedAt >= state.refreshCooldownMs
  },
}))

export function useTerminalProjectionHydrationPhase(
  workspaceId: MaybeRefOrGetter<WorkspaceId | null | undefined>,
  workspaceRuntimeId: MaybeRefOrGetter<string | null | undefined>,
): ComputedRef<TerminalProjectionHydrationPhase> {
  const entry = useTerminalProjectionHydrationEntry(workspaceId, workspaceRuntimeId)
  return computed(() => entry.value.phase)
}

export function useTerminalProjectionHydrationEntry(
  workspaceId: MaybeRefOrGetter<WorkspaceId | null | undefined>,
  workspaceRuntimeId: MaybeRefOrGetter<string | null | undefined>,
): ComputedRef<TerminalProjectionHydrationEntry> {
  const hydrationByWorkspace = useStoreSelector(terminalProjectionHydrationStore, (state) => state.hydrationByWorkspace)
  return computed(() => {
    const currentWorkspaceId = toValue(workspaceId)
    const currentRuntimeId = toValue(workspaceRuntimeId)
    if (!currentWorkspaceId || !currentRuntimeId) {
      return { workspaceRuntimeId: currentRuntimeId ?? '', phase: 'pending' }
    }
    const current = hydrationByWorkspace.value.get(currentWorkspaceId)
    return current?.workspaceRuntimeId === currentRuntimeId
      ? current
      : { workspaceRuntimeId: currentRuntimeId, phase: 'pending' }
  })
}

export function useIsInitialTerminalProjectionHydrating(
  workspaceId: MaybeRefOrGetter<WorkspaceId | null | undefined>,
  workspaceRuntimeId: MaybeRefOrGetter<string | null | undefined>,
): ComputedRef<boolean> {
  const entry = useTerminalProjectionHydrationEntry(workspaceId, workspaceRuntimeId)
  return computed(() => {
    const currentWorkspaceId = toValue(workspaceId)
    const currentRuntimeId = toValue(workspaceRuntimeId)
    return !!currentWorkspaceId && !!currentRuntimeId && entry.value.phase === 'pending'
  })
}
