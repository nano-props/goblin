import { toast } from 'sonner'

export type TerminalCreateTranslator = (key: string) => string

const SERVER_ERROR_KEY_PATTERN = /^error\.[a-z0-9.-]+$/

export function terminalCreateErrorKey(error: unknown): string {
  const message = terminalCreateErrorMessage(error)
  if (SERVER_ERROR_KEY_PATTERN.test(message)) return message
  if (message === 'Terminal socket open timed out' || message === 'App realtime socket open timed out') {
    return 'error.terminal-connection-timeout'
  }
  if (message === 'Terminal request timed out' || message === 'App realtime request timed out') {
    return 'error.terminal-create-timeout'
  }
  if (isTerminalConnectionFailure(message)) return 'error.terminal-connection-unavailable'
  if (isTerminalHostGeometryFailure(message)) return 'error.terminal-host-not-measurable'
  return 'error.terminal-create-failed'
}

export function showTerminalCreateErrorToast(error: unknown, t: TerminalCreateTranslator): string {
  const titleKey = 'action.result-error'
  const descriptionKey = terminalCreateErrorKey(error)
  toast.error(t(titleKey), { description: t(descriptionKey) })
  return descriptionKey
}

function terminalCreateErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return ''
}

function isTerminalConnectionFailure(message: string): boolean {
  return (
    message === 'Terminal socket unavailable' ||
    message === 'App realtime socket unavailable' ||
    message.startsWith('Terminal socket closed before open') ||
    message.startsWith('App realtime socket closed before open') ||
    message === 'Terminal socket error before open' ||
    message === 'App realtime socket error before open' ||
    message === 'Terminal socket closed' ||
    message === 'App realtime socket closed' ||
    message === 'Terminal socket error' ||
    message === 'App realtime socket error' ||
    message === 'Terminal heartbeat send failed' ||
    message === 'App realtime heartbeat send failed'
  )
}

function isTerminalHostGeometryFailure(message: string): boolean {
  return (
    message === 'terminal create host unavailable' ||
    message === 'host is inside a display:none subtree' ||
    message.startsWith('terminal create geometry wait timed out after ') ||
    message.startsWith('terminal host measurable wait timed out after ') ||
    message.startsWith('ResizeObserver unavailable; cannot wait for host to become measurable')
  )
}
