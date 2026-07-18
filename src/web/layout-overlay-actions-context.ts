import { createContext } from 'react'

interface LayoutOverlayActionsValue {
  openWorkspacePathDialog: () => void
  openCloneRepo: () => void
  openRemoteWorkspace: () => void
  /** Navigate the current repo route to the New Worktree page. */
  openCreateWorktree: () => void
}

export const LayoutOverlayActions = createContext<LayoutOverlayActionsValue | null>(null)
