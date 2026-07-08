import { createOpaqueId } from '#/shared/opaque-id.ts'
import { isValidTerminalClientId } from '#/shared/terminal-validators.ts'

const TERMINAL_SESSION_ID_RE = /^term-[A-Za-z0-9_-]{21}$/

export function createTerminalSessionId(): string {
  return createOpaqueId('term')
}

export function isValidTerminalSessionId(value: unknown): value is string {
  return typeof value === 'string' && TERMINAL_SESSION_ID_RE.test(value)
}

export { isValidTerminalClientId }
