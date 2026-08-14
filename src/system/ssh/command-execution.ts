import type { RemoteCommandResult } from '#/system/ssh/commands.ts'
import type { CommandExecution, CommandOutcome } from '#/system/command-execution.ts'
import type { ExecResult } from '#/shared/git-types.ts'

export function remoteExecResult(result: RemoteCommandResult): ExecResult {
  if (result.ok) return { ok: true, message: result.stdout || result.stderr || 'ok' }
  return { ok: false, message: result.message || result.stderr || 'error.unknown' }
}

export function remoteCommandExecution(result: RemoteCommandResult): CommandExecution {
  if (result.commandNotStarted) return { status: 'not-started' }
  if (result.ok) return { status: 'succeeded' }
  if (result.remoteStartUnconfirmed) return { status: 'remote-start-unconfirmed' }
  if (result.timedOut) return { status: 'timed-out' }
  if (result.message === 'cancelled') return { status: 'cancelled' }
  return { status: 'failed' }
}

export function remoteCommandOutcome(result: RemoteCommandResult): CommandOutcome {
  return { result: remoteExecResult(result), execution: remoteCommandExecution(result) }
}
