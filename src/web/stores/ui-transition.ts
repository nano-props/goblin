// Ephemeral UI transition flags. The compact-workspace pane renders
// a fixed-duration exit animation when the user deselects a branch
// (or selects a different one) — for `WORKSPACE_PANE_TRANSITION_MS`
// the workspace content is still showing the OLD branch while the
// live route has moved to the NEW branch. The keyboard handler
// receives the current route branch from `Layout`, so
// during that 240 ms window pressing a branch-action shortcut would
// act on the new branch while the user sees the old one.
//
// `WorkspaceView` sets `isCompactWorkspaceTransitioning = true` while the
// transition is in flight and clears it when the timer elapses. The
// keyboard handler reads the flag in `isWorkspaceShortcutSuppressed`
// (via the Layout) and suppresses branch-action shortcuts for the
// duration. A 240 ms suppression is imperceptible to the user but
// prevents the visual/keyboard mismatch.

import { create } from 'zustand'

interface UiTransitionState {
  isCompactWorkspaceTransitioning: boolean
  setCompactWorkspaceTransitioning: (value: boolean) => void
}

export const useUiTransitionStore = create<UiTransitionState>()((set) => ({
  isCompactWorkspaceTransitioning: false,
  setCompactWorkspaceTransitioning: (value) => set({ isCompactWorkspaceTransitioning: value }),
}))
