import crypto from 'node:crypto'
import { isValidTerminalClientId } from '#/shared/terminal-validators.ts'

const TERMINAL_SESSION_ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const TERMINAL_SESSION_ID_RANDOM_BYTES = 16
const TERMINAL_SESSION_ID_BASE36_LENGTH = 25

export function createTerminalSessionId(): string {
  const value = BigInt(`0x${crypto.randomBytes(TERMINAL_SESSION_ID_RANDOM_BYTES).toString('hex')}`)
  return `terminal-session-${value.toString(36).padStart(TERMINAL_SESSION_ID_BASE36_LENGTH, '0')}`
}

export function isValidTerminalSessionId(value: unknown): value is string {
  return typeof value === 'string' && TERMINAL_SESSION_ID_RE.test(value)
}

export { isValidTerminalClientId }
