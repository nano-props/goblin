import type { ExecResult } from '#/shared/git-types.ts'

export type CommandExecution = {
  /** `not-started` proves the target mutation command was not invoked. */
  status: 'not-started' | 'succeeded' | 'failed' | 'timed-out' | 'cancelled' | 'remote-start-unconfirmed'
}

export interface CommandOutcome<T extends ExecResult = ExecResult> {
  result: T
  execution: CommandExecution
}

export function commandMayHaveRun(execution: CommandExecution): boolean {
  return execution.status !== 'not-started'
}

export function withoutMutationCommand<T extends ExecResult>(result: T): CommandOutcome<T> {
  return { result, execution: { status: 'not-started' } }
}
