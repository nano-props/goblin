import { createContext } from 'react'

export interface LayoutOverlayActionsValue {
  openRepoPathDialog: () => void
  openCloneRepo: () => void
  openRemoteRepo: () => void
}

export const LayoutOverlayActions = createContext<LayoutOverlayActionsValue | null>(null)
