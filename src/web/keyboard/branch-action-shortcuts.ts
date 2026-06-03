import type { BranchActionItemId } from '#/web/hooks/useBranchActions.tsx'
type BranchActionShortcutHandler = (action: BranchActionItemId) => void

let handler: BranchActionShortcutHandler | null = null

export function setBranchActionShortcutHandler(next: BranchActionShortcutHandler): () => void {
  handler = next
  return () => {
    if (handler === next) handler = null
  }
}

export function runBranchActionShortcut(action: BranchActionItemId) {
  handler?.(action)
}
