import type { TerminalController } from '#/shared/terminal-types.ts'

/**
 * Server-side attachment membership and controller intent. Geometry belongs
 * to the current bound PTY state, never to an attachment or create request.
 */
export type TerminalAuthorityReason = 'not-controller' | 'session-unowned' | 'unknown-client'

type TerminalAuthorityDecision = { kind: 'allow' } | { kind: 'deny'; reason: TerminalAuthorityReason }

export type TerminalClientPresence = (clientId: string) => boolean

export interface TerminalControllerState {
  attachments: Set<string>
  /** Controller intent. Effective controller is derived with live presence. */
  controllerClientId: string | null
}

export type TerminalAttachmentDecision = 'controller' | 'viewer' | 'unavailable'

export interface TerminalClientAdmission {
  commit(): void
  rollback(): void
}

export function isAuthoritative(
  state: TerminalControllerState,
  clientId: string,
  isClientOnline: TerminalClientPresence,
): boolean {
  return decideTerminalAuthority(state, clientId, isClientOnline).kind === 'allow'
}

export function explainAuthority(
  state: TerminalControllerState,
  clientId: string,
  isClientOnline: TerminalClientPresence,
): TerminalAuthorityReason | null {
  const decision = decideTerminalAuthority(state, clientId, isClientOnline)
  return decision.kind === 'allow' ? null : decision.reason
}

function decideTerminalAuthority(
  state: TerminalControllerState,
  clientId: string,
  isClientOnline: TerminalClientPresence,
): TerminalAuthorityDecision {
  if (!state.attachments.has(clientId) || !isClientOnline(clientId)) {
    return { kind: 'deny', reason: 'unknown-client' }
  }
  const controller = effectiveTerminalController(state, isClientOnline)
  if (controller === null) return { kind: 'deny', reason: 'session-unowned' }
  if (controller.clientId !== clientId) return { kind: 'deny', reason: 'not-controller' }
  return { kind: 'allow' }
}

export function effectiveTerminalController(
  state: TerminalControllerState,
  isClientOnline: TerminalClientPresence,
): TerminalController | null {
  const clientId = state.controllerClientId
  if (!clientId || !state.attachments.has(clientId) || !isClientOnline(clientId)) return null
  return { clientId, status: 'connected' }
}

export function decideTerminalClientAttachment(
  state: TerminalControllerState,
  clientId: string,
  isClientOnline: TerminalClientPresence,
): TerminalAttachmentDecision {
  if (!isClientOnline(clientId)) return 'unavailable'
  const controller = effectiveTerminalController(state, isClientOnline)
  return controller === null || controller.clientId === clientId ? 'controller' : 'viewer'
}

export function commitTerminalClientAttachment(
  state: TerminalControllerState,
  clientId: string,
  decision: Exclude<TerminalAttachmentDecision, 'unavailable'>,
): void {
  state.attachments.add(clientId)
  if (decision === 'controller') state.controllerClientId = clientId
}

/**
 * Stages first-attach membership so it commits in the same synchronous adopt
 * boundary as the native PTY handle and bound render state.
 */
export function prepareTerminalClientAdmission(
  state: TerminalControllerState,
  clientId: string,
  decision: Exclude<TerminalAttachmentDecision, 'unavailable'>,
  isClientOnline: TerminalClientPresence,
  canCommit: () => boolean,
): TerminalClientAdmission {
  const wasAttached = state.attachments.has(clientId)
  const previousControllerClientId = state.controllerClientId
  return {
    commit(): void {
      if (!canCommit() || !isClientOnline(clientId)) throw new Error('error.unavailable')
      commitTerminalClientAttachment(state, clientId, decision)
    },
    rollback(): void {
      if (wasAttached) state.attachments.add(clientId)
      else state.attachments.delete(clientId)
      state.controllerClientId = previousControllerClientId
    },
  }
}

export function claimTerminalClientControl(
  state: TerminalControllerState,
  clientId: string,
  isClientOnline: TerminalClientPresence,
): boolean {
  if (!isClientOnline(clientId)) return false
  // Explicit takeover is also the page's attachment admission. Viewers are
  // discovered from the user-scoped session projection and intentionally do
  // not perform a snapshot attach until after they win control.
  state.attachments.add(clientId)
  state.controllerClientId = clientId
  return true
}

/** Removes page-scoped attachment membership and any controller intent it owns. */
export function expireTerminalClient(state: TerminalControllerState, clientId: string): boolean {
  const attachmentRemoved = state.attachments.delete(clientId)
  const controlled = state.controllerClientId === clientId
  if (controlled) state.controllerClientId = null
  return attachmentRemoved || controlled
}

export function terminalIdentityChanged(
  state: TerminalControllerState,
  previous: TerminalController | null,
  isClientOnline: TerminalClientPresence,
): boolean {
  const next = effectiveTerminalController(state, isClientOnline)
  return previous?.clientId !== next?.clientId || previous?.status !== next?.status
}
