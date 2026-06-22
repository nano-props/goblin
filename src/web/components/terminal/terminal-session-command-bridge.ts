import type { WorktreeTerminalSnapshot, TerminalSessionBase } from '#/web/components/terminal/types.ts'

interface TerminalSessionCommandBridge {
  worktreeSnapshot: (worktreeTerminalKey: string) => WorktreeTerminalSnapshot
  createTerminal: (base: TerminalSessionBase) => Promise<string>
  selectTerminal: (worktreeTerminalKey: string, key: string) => void
  closeTerminalByDescriptor?: (key: string, base: TerminalSessionBase) => void
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
