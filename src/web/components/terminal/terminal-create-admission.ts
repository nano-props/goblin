import type { TerminalCreateAction } from '#/shared/terminal-types.ts'

/**
 * Client admission result for a server-committed terminal runtime open.
 *
 * `runtimeProjectionApplied` is intentionally independent from the server
 * commit: a client that has already moved to another repo runtime may skip
 * local terminal hydration without acquiring rollback ownership over the
 * committed server resource.
 */
export interface TerminalCreateAdmissionBase {
  terminalSessionId: string
  branch: string
  resourceDisposition: TerminalCreateAction
  runtimeProjectionApplied: boolean
}

export interface TerminalCreateLeaderAdmissionResult extends TerminalCreateAdmissionBase {
  requestRole: 'leader'
}

export interface TerminalCreateObserverAdmissionResult extends TerminalCreateAdmissionBase {
  requestRole: 'observer'
}

export type TerminalCreateAdmissionResult = TerminalCreateLeaderAdmissionResult | TerminalCreateObserverAdmissionResult
