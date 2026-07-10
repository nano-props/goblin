import type { TerminalCreateAction } from '#/shared/terminal-types.ts'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'

/**
 * Client admission result for a server-committed terminal runtime open.
 *
 * `runtimeProjectionApplied` is intentionally independent from the server
 * commit: a client that has already moved to another repo runtime may skip
 * local terminal hydration without acquiring rollback ownership over the
 * committed server resource.
 */
interface TerminalCreateAdmissionBase {
  terminalSessionId: string
  resourceDisposition: TerminalCreateAction
  workspacePaneTabs: WorkspacePaneTabEntry[]
  runtimeProjectionApplied: boolean
}

export type TerminalCreateAdmissionResult = TerminalCreateAdmissionBase &
  ({ requestRole: 'leader' } | { requestRole: 'observer' })
