import { isValidTerminalClientId } from '#/shared/terminal-validators.ts'

const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

export function isValidTerminalSessionId(value: unknown): value is string {
  return typeof value === 'string' && SESSION_ID_RE.test(value)
}

export { isValidTerminalClientId }
