import type { TerminalRetirementPresentationContext, TerminalSessionSummary } from '#/shared/terminal-types.ts'

export type TerminalCloseOutcome = { kind: 'closed' } | { kind: 'already-closed' } | { kind: 'failed' }

export type TerminalSessionCloseOutcome =
  | {
      kind: 'closed'
      session: TerminalSessionSummary
      catalogRevision: number
      retirementPresentation: TerminalRetirementPresentationContext | null
    }
  | { kind: 'already-closed' }
  | { kind: 'failed' }
