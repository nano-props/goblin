import type { TerminalSessionSummary } from '#/shared/terminal-types.ts'

export type TerminalCloseOutcome = { kind: 'closed' } | { kind: 'already-closed' } | { kind: 'failed' }

export type TerminalSessionCloseOutcome =
  | { kind: 'closed'; session: TerminalSessionSummary }
  | { kind: 'already-closed' }
  | { kind: 'failed' }
