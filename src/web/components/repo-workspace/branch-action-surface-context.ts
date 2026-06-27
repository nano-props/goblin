import { createContext, useContext } from 'react'
import type { BranchActionSurface } from '#/web/hooks/useBranchActionItems.ts'

// `useBranchActionItems` builds the menu items, shortcut dispatchers,
// and the in-context patch button for a single branch. They are
// surfaced here so deeply nested children (e.g. the status tab) can
// pull a specific slice without prop-drilling the whole surface
// through every intermediate component. Confirm dialogs no longer
// live on the surface — they are owned by
// `useBranchActionDialogsStore` and rendered by the layout-level
// `BranchActionDialogHost`.
export const BranchActionSurfaceContext = createContext<BranchActionSurface | null>(null)

export function useBranchActionSurface(): BranchActionSurface {
  const value = useContext(BranchActionSurfaceContext)
  if (!value) throw new Error('Branch action surface context is unavailable')
  return value
}
