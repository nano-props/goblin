import type { TerminalCreateOptions, TerminalWorktreeSnapshot } from '#/web/components/terminal/types.ts'
import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneRuntimeTabPlacement } from '#/shared/workspace-pane-runtime.ts'

export type TerminalCreateAdmissionResult = {
  terminalSessionId: string
  requestRole: 'leader' | 'observer'
  resourceDisposition: 'created' | 'restored' | 'reused'
  workspacePaneTabs: WorkspacePaneTabEntry[]
}

export interface TerminalSessionCommandBridge {
  terminalWorktreeSnapshot: (terminalWorktreeKey: string) => TerminalWorktreeSnapshot
  createTerminal: (base: TerminalSessionBase, options?: TerminalCreateOptions) => Promise<string>
  createTerminalWithAdmission: (
    base: TerminalSessionBase,
    options?: TerminalCreateOptions,
    placement?: WorkspacePaneRuntimeTabPlacement,
  ) => Promise<TerminalCreateAdmissionResult>
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
