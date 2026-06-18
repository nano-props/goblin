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

// `resolveAttachmentConnected` previously lived here as a stub
// that returned `true` whenever an attachmentId was present. The
// runtime now wires a real broker-backed check via dependency
// injection into `createTerminalRuntimeActions` — see
// `terminal-runtime.ts` for the call site. The previous code smell
// is fixed there, not here, because the broker reference is owned
// by the runtime's coordinator and can't be reached from this
// module without a circular import.
