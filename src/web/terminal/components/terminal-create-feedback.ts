import { toast } from 'vue-sonner'
import { ClientRealtimeRequestError } from '#/web/realtime/client-realtime-request-error.ts'

export type TerminalCreateTranslator = (key: string) => string

const SERVER_ERROR_KEY_PATTERN = /^error\.[a-z0-9.-]+$/

export function terminalCreateErrorKey(error: unknown): string {
  if (error instanceof ClientRealtimeRequestError) return terminalCreateRealtimeErrorKey(error)
  const message = terminalCreateErrorMessage(error)
  if (message === 'error.unavailable') return 'error.terminal-create-failed'
  if (SERVER_ERROR_KEY_PATTERN.test(message)) return message
  return 'error.terminal-create-failed'
}

function terminalCreateRealtimeErrorKey(error: ClientRealtimeRequestError): string {
  if (error.kind === 'app-quitting') return 'error.terminal-create-failed'
  if (error.delivery === 'indeterminate') return 'error.operation-outcome-uncertain'
  if (error.kind === 'open-timeout') return 'error.terminal-connection-timeout'
  if (error.kind === 'timeout') return 'error.terminal-create-timeout'
  return 'error.terminal-connection-unavailable'
}

export function showTerminalCreateErrorToast(error: unknown, t: TerminalCreateTranslator): string {
  const titleKey = 'action.result-error'
  const descriptionKey = terminalCreateErrorKey(error)
  if (descriptionKey === 'error.operation-outcome-uncertain') {
    toast.warning(t(descriptionKey))
  } else {
    toast.error(t(titleKey), { description: t(descriptionKey) })
  }
  return descriptionKey
}

function terminalCreateErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return ''
}
