import type { BranchActionShortcutAction } from '#/shared/shortcut-definitions.ts'
type BranchActionShortcutHandler = (action: BranchActionShortcutAction) => void

let handler: BranchActionShortcutHandler | null = null

export function setBranchActionShortcutHandler(next: BranchActionShortcutHandler): () => void {
  handler = next
  return () => {
    if (handler === next) handler = null
  }
}

export function runBranchActionShortcut(action: BranchActionShortcutAction) {
  handler?.(action)
}
