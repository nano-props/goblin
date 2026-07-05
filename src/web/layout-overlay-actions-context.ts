import { createContext } from 'react'

interface LayoutOverlayActionsValue {
  openRepoPathDialog: () => void
  openCloneRepo: () => void
  openRemoteRepo: () => void
  /** Navigate the current repo route to the New Worktree page. */
  openCreateWorktree: () => void
}

export const LayoutOverlayActions = createContext<LayoutOverlayActionsValue | null>(null)
