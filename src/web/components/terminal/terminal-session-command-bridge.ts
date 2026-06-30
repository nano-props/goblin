import type { WorktreeTerminalSnapshot, TerminalCreateOptions } from '#/web/components/terminal/types.ts'
import type { TerminalSessionBase } from '#/shared/terminal-types.ts'

interface TerminalSessionCommandBridge {
  worktreeSnapshot: (worktreeTerminalKey: string) => WorktreeTerminalSnapshot
  createTerminal: (base: TerminalSessionBase, options?: TerminalCreateOptions) => Promise<string>
  selectTerminal: (worktreeTerminalKey: string, terminalKey: string) => void
  closeTerminalByDescriptor?: (terminalKey: string, base: TerminalSessionBase) => Promise<boolean>
  closeTerminalsForWorktree?: (base: TerminalSessionBase) => Promise<boolean>
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
