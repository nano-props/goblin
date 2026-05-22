import type { BranchActionOp } from '#/renderer/hooks/useBranchActions.tsx'

type BranchActionShortcutHandler = (action: BranchActionOp) => void

let handler: BranchActionShortcutHandler | null = null

export function setBranchActionShortcutHandler(next: BranchActionShortcutHandler): () => void {
  handler = next
  return () => {
    if (handler === next) handler = null
  }
}

export function runBranchActionShortcut(action: BranchActionOp) {
  handler?.(action)
}
