import type { WorktreeTerminalSnapshot, TerminalSessionBase } from '#/web/components/terminal/types.ts'
import type {
  WorkspacePaneWorktreeStaticViewType,
  WorkspacePaneWorktreeViewOrderEntry,
} from '#/shared/workspace-pane.ts'

interface TerminalSessionCommandBridge {
  worktreeSnapshot: (worktreeTerminalKey: string) => WorktreeTerminalSnapshot
  createTerminal: (base: TerminalSessionBase) => Promise<string>
  selectTerminal: (worktreeTerminalKey: string, key: string) => void
  closeTerminalByDescriptor?: (key: string, base: TerminalSessionBase) => void
  openWorkspacePaneView: (worktreeTerminalKey: string, type: WorkspacePaneWorktreeStaticViewType) => Promise<boolean>
  closeWorkspacePaneView: (worktreeTerminalKey: string, type: WorkspacePaneWorktreeStaticViewType) => Promise<boolean>
  reorderWorkspacePaneViews: (
    worktreeTerminalKey: string,
    orderedViews: WorkspacePaneWorktreeViewOrderEntry[],
  ) => Promise<boolean>
}

let bridge: TerminalSessionCommandBridge | null = null

export function setTerminalSessionCommandBridge(next: TerminalSessionCommandBridge | null): () => void {
  bridge = next
  return () => {
    if (bridge === next) bridge = null
  }
}

export function readTerminalSessionCommandBridge(): TerminalSessionCommandBridge | null {
  return bridge
}
