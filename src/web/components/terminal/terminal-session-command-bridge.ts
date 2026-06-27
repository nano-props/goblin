import type { WorktreeTerminalSnapshot, TerminalSlotBase } from '#/web/components/terminal/types.ts'

interface TerminalSlotCommandBridge {
  worktreeSnapshot: (worktreeTerminalKey: string) => WorktreeTerminalSnapshot
  createTerminal: (base: TerminalSlotBase) => Promise<string>
  selectTerminal: (worktreeTerminalKey: string, key: string) => void
  closeTerminalByDescriptor?: (key: string, base: TerminalSlotBase) => Promise<boolean>
  closeTerminalsForWorktree?: (base: TerminalSlotBase) => Promise<boolean>
}

let bridge: TerminalSlotCommandBridge | null = null

export function setTerminalSlotCommandBridge(next: TerminalSlotCommandBridge | null): () => void {
  bridge = next
  return () => {
    if (bridge === next) bridge = null
  }
}

export function readTerminalSlotCommandBridge(): TerminalSlotCommandBridge | null {
  return bridge
}
