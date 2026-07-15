import { t } from 'i18next'
import { toast } from 'sonner'
import type { TerminalWriteResult } from '#/shared/terminal-types.ts'
import { terminalLog } from '#/web/logger.ts'
import { ClientRealtimeRequestError } from '#/web/realtime/client-realtime-socket-connection.ts'

export interface TerminalWriteFailureInput {
  terminalRuntimeSessionId: string
  failure:
    { kind: 'result'; result: Exclude<TerminalWriteResult, { status: 'accepted' }> } | { kind: 'error'; error: unknown }
}

export interface TerminalWriteFailureReporter {
  report(input: TerminalWriteFailureInput): void
}

/** Projection-scoped presentation state. Connection truth stays in realtime. */
export function createTerminalWriteFailureReporter(): TerminalWriteFailureReporter {
  let highestReportedOutageId = 0

  return {
    report({ terminalRuntimeSessionId, failure }) {
      const error = failure.kind === 'error' ? failure.error : null
      if (error instanceof ClientRealtimeRequestError && error.kind === 'app-quitting') return
      const outageId = error instanceof ClientRealtimeRequestError ? error.outageId : null
      if (outageId !== null && outageId <= highestReportedOutageId) return
      if (outageId !== null) highestReportedOutageId = outageId

      terminalLog.warn('write failed for session', { terminalRuntimeSessionId, failure, outageId })
      const messageKey = terminalWriteFailureKey(failure)
      toast.warning(t(messageKey), { id: `terminal-write-failure:${messageKey}` })
    },
  }
}

function terminalWriteFailureKey(failure: TerminalWriteFailureInput['failure']): string {
  if (failure.kind === 'result') {
    return failure.result.status === 'rejected'
      ? 'terminal.write-blocked-rejected'
      : 'terminal.write-delivery-uncertain'
  }
  if (failure.error instanceof ClientRealtimeRequestError) {
    return failure.error.delivery === 'not-sent' ? 'terminal.write-not-sent' : 'terminal.write-delivery-uncertain'
  }
  return 'terminal.write-delivery-uncertain'
}
