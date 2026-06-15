import { isValidTerminalAttachmentId } from '#/shared/terminal-validators.ts'

const TERMINAL_CLIENT_ID_RE = /^[A-Za-z0-9_-]{1,128}$/
const TERMINAL_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

export function isValidTerminalClientId(value: unknown): value is string {
  return typeof value === 'string' && TERMINAL_CLIENT_ID_RE.test(value)
}

export function isValidTerminalId(value: unknown): value is string {
  return typeof value === 'string' && TERMINAL_ID_RE.test(value)
}

export function isValidTerminalSocketAttachmentId(value: unknown): value is string {
  return typeof value === 'string' && isValidTerminalAttachmentId(value)
}

export function resolveAttachmentConnected(_clientId: string, attachmentId?: string): boolean | undefined {
  return attachmentId ? true : undefined
}
