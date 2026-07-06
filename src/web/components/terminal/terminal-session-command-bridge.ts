import type {
  TerminalCreateOptions,
  TerminalCreateOwner,
  TerminalWorktreeSnapshot,
} from '#/web/components/terminal/types.ts'
import type { TerminalSessionBase } from '#/shared/terminal-types.ts'

interface TerminalSessionCommandBridge {
  terminalWorktreeSnapshot: (terminalWorktreeKey: string) => TerminalWorktreeSnapshot
  createTerminal: (base: TerminalSessionBase, options?: TerminalCreateOptions) => Promise<string>
  createOwnedTerminal?: (
    base: TerminalSessionBase,
    owner: TerminalCreateOwner,
    options?: TerminalCreateOptions,
  ) => Promise<string>
  selectTerminal: (terminalWorktreeKey: string, terminalSessionId: string) => void
  closeTerminalByDescriptor?: (terminalSessionId: string, base: TerminalSessionBase) => Promise<boolean>
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
