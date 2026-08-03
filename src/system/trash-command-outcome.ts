import type { ExecResult } from '#/shared/git-types.ts'

export type TrashCommandExecutionStatus =
  | 'not-started'
  | 'succeeded'
  | 'failed'
  | 'timed-out'
  | 'cancelled'

export interface TrashCommandOutcome {
  result: ExecResult
  execution: { status: TrashCommandExecutionStatus }
}

export function trashCommandMayHaveRun(outcome: TrashCommandOutcome): boolean {
  return outcome.execution.status !== 'not-started'
}

export class TrashCommandInvokedError extends Error {
  override readonly cause: unknown

  constructor(cause: unknown) {
    super('trash command failed after invocation', { cause })
    this.name = 'TrashCommandInvokedError'
    this.cause = cause
  }
}

export function isTrashCommandInvokedError(error: unknown): error is TrashCommandInvokedError {
  return error instanceof TrashCommandInvokedError
}
