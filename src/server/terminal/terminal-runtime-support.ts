import { isValidTerminalClientId } from '#/shared/terminal-validators.ts'

const SLOT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

export function isValidSlotId(value: unknown): value is string {
  return typeof value === 'string' && SLOT_ID_RE.test(value)
}

// `resolveClientConnected` previously lived here as a stub
// that returned `true` whenever an clientId was present. The
// runtime now wires a real broker-backed check via dependency
// injection into `createTerminalRuntimeActions` — see
// `terminal-runtime.ts` for the call site. The previous code smell
// is fixed there, not here, because the broker reference is owned
// by the runtime's coordinator and can't be reached from this
// module without a circular import.

export { isValidTerminalClientId }
