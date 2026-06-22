import { createContext, useContext } from 'react'
import type { BranchActionSurface } from '#/web/hooks/useBranchActionItems.ts'

// `useBranchActionItems` builds the menu items, shortcut dispatchers,
// in-context patch button, and confirm dialogs for a single branch.
// They are surfaced here so deeply nested children (e.g. the status
// tab) can pull a specific slice without prop-drilling the whole
// surface through every intermediate component.
export const BranchActionSurfaceContext = createContext<BranchActionSurface | null>(null)

export function useBranchActionSurface(): BranchActionSurface {
  const value = useContext(BranchActionSurfaceContext)
  if (!value) throw new Error('Branch action surface context is unavailable')
  return value
}
