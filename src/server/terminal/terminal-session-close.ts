import type { TerminalSessionSummary } from '#/shared/terminal-types.ts'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'

export type TerminalCloseOutcome = { kind: 'closed' } | { kind: 'already-closed' } | { kind: 'failed' }

export type TerminalSessionCloseOutcome =
  | {
      kind: 'closed'
      session: TerminalSessionSummary
      tabsBeforeRetirement: WorkspacePaneTabEntry[] | null
    }
  | { kind: 'already-closed' }
  | { kind: 'failed' }
