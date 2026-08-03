import type { ExecResult } from '#/shared/git-types.ts'
import type { CommandExecution, CommandOutcome } from '#/system/command-execution.ts'

export function commandOutcomeForTest<T extends ExecResult>(
  result: T,
  status: CommandExecution['status'] = 'succeeded',
): CommandOutcome<T> {
  return { result, execution: { status } }
}
