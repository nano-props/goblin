import type { TerminalController } from '#/shared/terminal-types.ts'

/**
 * Per-action authority decisions.
 *
 * The terminal session stores attachment metadata and controller intent.
 * Client liveness is deliberately not copied into the session; callers
 * provide the current presence snapshot so effective controller state is
 * derived from one source of truth.
 */
export type TerminalAuthorityAction = 'write' | 'resize' | 'restart' | 'takeover'

export type TerminalAuthorityReason = 'not-controller' | 'session-unowned' | 'unknown-client'

type TerminalAuthorityDecision = { kind: 'allow' } | { kind: 'deny'; reason: TerminalAuthorityReason }

export type TerminalClientPresence = (clientId: string) => boolean

export function isAuthoritative(
  state: TerminalControllerState,
  clientId: string,
  action: TerminalAuthorityAction,
  isClientOnline: TerminalClientPresence,
): boolean {
  return decideTerminalActionAuthority(state, clientId, action, isClientOnline).kind === 'allow'
}

export function explainAuthority(
  state: TerminalControllerState,
  clientId: string,
  action: TerminalAuthorityAction,
  isClientOnline: TerminalClientPresence,
): TerminalAuthorityReason | null {
  const decision = decideTerminalActionAuthority(state, clientId, action, isClientOnline)
  return decision.kind === 'allow' ? null : decision.reason
}

function decideTerminalActionAuthority(
  state: TerminalControllerState,
  clientId: string,
  action: TerminalAuthorityAction,
  isClientOnline: TerminalClientPresence,
): TerminalAuthorityDecision {
  const attachment = state.attachments.get(clientId)
  if (!attachment) return { kind: 'deny', reason: 'unknown-client' }
  if (action === 'takeover') return { kind: 'allow' }
  const controller = effectiveTerminalController(state, isClientOnline)
  if (controller === null) return { kind: 'deny', reason: 'session-unowned' }
  if (controller.clientId !== clientId) return { kind: 'deny', reason: 'not-controller' }
  return { kind: 'allow' }
}

/** Per-client attachment metadata owned by the terminal session. */
export interface TerminalClientControllerState {
  cols: number
  rows: number
}

export interface TerminalControllerState {
  attachments: Map<string, TerminalClientControllerState>
  /** Controller intent. Effective controller is derived with presence. */
  controllerClientId: string | null
  /**
   * Sticky user-level claim. Set on the first successful attach or
   * explicit takeover for the session. Persists for the lifetime of
   * the session so a subsequent attachment can auto-claim when no
   * effective controller is present.
   */
  userSticky: boolean
  cols: number
  rows: number
}

export interface TerminalControllerEffect {
  resizeTo?: { cols: number; rows: number }
  emitIdentity: boolean
}

export function effectiveTerminalController(
  state: TerminalControllerState,
  isClientOnline: TerminalClientPresence,
): TerminalController | null {
  const clientId = state.controllerClientId
  if (!clientId) return null
  if (!state.attachments.has(clientId)) return null
  if (!isClientOnline(clientId)) return null
  return { clientId, status: 'connected' }
}

export function registerTerminalClient(
  state: TerminalControllerState,
  clientId: string,
  cols: number,
  rows: number,
): void {
  state.attachments.set(clientId, { cols, rows })
}

export function projectAttachedTerminalController(
  state: TerminalControllerState,
  clientId: string,
  cols: number,
  rows: number,
  isClientOnline: TerminalClientPresence,
): TerminalController | null {
  const projected: TerminalControllerState = {
    controllerClientId: state.controllerClientId,
    userSticky: state.userSticky,
    attachments: new Map(state.attachments),
    cols: state.cols,
    rows: state.rows,
  }
  registerTerminalClient(projected, clientId, cols, rows)
  attachTerminalClient(projected, clientId, isClientOnline)
  return effectiveTerminalController(projected, isClientOnline)
}

export function attachTerminalClient(
  state: TerminalControllerState,
  clientId: string,
  isClientOnline: TerminalClientPresence,
): TerminalControllerEffect {
  const attachment = state.attachments.get(clientId)
  if (!attachment || !isClientOnline(clientId)) return { emitIdentity: false }

  const controller = effectiveTerminalController(state, isClientOnline)
  if (controller?.clientId === clientId) {
    const sizeChanged = state.cols !== attachment.cols || state.rows !== attachment.rows
    state.controllerClientId = clientId
    state.userSticky = true
    return {
      resizeTo: sizeChanged ? { cols: attachment.cols, rows: attachment.rows } : undefined,
      emitIdentity: !sizeChanged,
    }
  }

  if (controller === null) return claimTerminalClientControl(state, clientId, isClientOnline)
  return { emitIdentity: false }
}

export function claimTerminalClientControl(
  state: TerminalControllerState,
  clientId: string,
  isClientOnline: TerminalClientPresence,
): TerminalControllerEffect {
  const attachment = state.attachments.get(clientId)
  if (!attachment || !isClientOnline(clientId)) return { emitIdentity: false }
  const sizeChanged = state.cols !== attachment.cols || state.rows !== attachment.rows
  state.controllerClientId = clientId
  state.userSticky = true
  return {
    resizeTo: sizeChanged ? { cols: attachment.cols, rows: attachment.rows } : undefined,
    emitIdentity: !sizeChanged,
  }
}

export function restartTerminalClientControl(
  state: TerminalControllerState,
  clientId: string,
  isClientOnline: TerminalClientPresence,
): void {
  state.controllerClientId = state.attachments.has(clientId) && isClientOnline(clientId) ? clientId : null
  if (state.controllerClientId) state.userSticky = true
}

export function terminalIdentityChanged(
  state: TerminalControllerState,
  previous: TerminalController | null,
  isClientOnline: TerminalClientPresence,
): boolean {
  const next = effectiveTerminalController(state, isClientOnline)
  return previous?.clientId !== next?.clientId || previous?.status !== next?.status
}
