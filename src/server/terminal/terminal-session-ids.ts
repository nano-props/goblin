import { createOpaqueId } from '#/shared/opaque-id.ts'
import { isValidTerminalClientId } from '#/shared/terminal-validators.ts'

const TERMINAL_SESSION_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

export function createTerminalSessionId(): string {
  return createOpaqueId('terminal-session')
}

export function isValidTerminalSessionId(value: unknown): value is string {
  return typeof value === 'string' && TERMINAL_SESSION_ID_RE.test(value)
}

export { isValidTerminalClientId }
