import { createContext } from 'react'

export interface LayoutOverlayActionsValue {
  openRepoPathDialog: () => void
  openCloneRepo: () => void
  openRemoteRepo: () => void
  /**
   * Open the create-worktree dialog for the currently active repo. The
   * dialog itself is mounted in `Layout.PrimaryWindowOverlays` so it
   * survives settings ⇄ workspace navigation — half-typed branch
   * names and ref selections are not lost when the user navigates
   * away and back.
   */
  openCreateWorktree: () => void
}

export const LayoutOverlayActions = createContext<LayoutOverlayActionsValue | null>(null)
