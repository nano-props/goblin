import type { TerminalController, TerminalControllerStatus } from '#/shared/terminal-types.ts'

/**
 * Per-action authority decisions. Each controller-mutating action has its
 * own policy:
 *
 * - `write` and `resize` require the caller to already be the controller
 *   (no implicit auto-claim, no preemption). A non-controller caller
 *   is told to acquire control first.
 * - `restart` is the same as `write`/`resize` — it tears down the PTY and
 *   reassigns control, so non-controllers must takeover first. An
 *   unowned session (controller === null) also rejects: restart
 *   reassigns control to the caller, which is effectively a takeover
 *   of an unowned session; we funnel those through the explicit
 *   takeover path so the audit trail stays consistent.
 * - `takeover` is the only path that may preempt an existing controller
 *   or claim an unowned session.
 */
export type TerminalAuthorityAction = 'write' | 'resize' | 'restart' | 'takeover'

export type TerminalAuthorityReason = 'not-controller' | 'session-unowned' | 'unknown-attachment'

export type TerminalAuthorityDecision = { kind: 'allow' } | { kind: 'deny'; reason: TerminalAuthorityReason }

export function isAuthoritative(
  state: TerminalOwnershipState,
  attachmentId: string,
  action: TerminalAuthorityAction,
): boolean {
  return decideTerminalActionAuthority(state, attachmentId, action).kind === 'allow'
}

export function explainAuthority(
  state: TerminalOwnershipState,
  attachmentId: string,
  action: TerminalAuthorityAction,
): TerminalAuthorityReason | null {
  const decision = decideTerminalActionAuthority(state, attachmentId, action)
  return decision.kind === 'allow' ? null : decision.reason
}

export function decideTerminalActionAuthority(
  state: TerminalOwnershipState,
  attachmentId: string,
  action: TerminalAuthorityAction,
): TerminalAuthorityDecision {
  const attachment = state.attachments.get(attachmentId)
  if (!attachment) return { kind: 'deny', reason: 'unknown-attachment' }
  if (action === 'takeover') return { kind: 'allow' }
  // write / resize / restart all require controller identity
  if (state.controller === null) return { kind: 'deny', reason: 'session-unowned' }
  if (state.controller.attachmentId !== attachmentId) return { kind: 'deny', reason: 'not-controller' }
  return { kind: 'allow' }
}

export interface TerminalAttachmentState {
  cols: number
  rows: number
  connected: boolean
}

export interface TerminalOwnershipState {
  attachments: Map<string, TerminalAttachmentState>
  controller: TerminalController | null
  allowImplicitAttachControl: boolean
  cols: number
  rows: number
}

export interface TerminalOwnershipEffect {
  resizeTo?: { cols: number; rows: number }
  emitOwnership: boolean
}

export interface TerminalAttachmentExpiryEffect {
  emitOwnership: boolean
  removed: boolean
}

export function registerTerminalAttachment(
  state: TerminalOwnershipState,
  attachmentId: string,
  cols: number,
  rows: number,
  connected?: boolean,
): void {
  const existing = state.attachments.get(attachmentId)
  state.attachments.set(attachmentId, {
    cols,
    rows,
    connected: connected ?? existing?.connected ?? false,
  })
}

export function attachTerminalAttachment(state: TerminalOwnershipState, attachmentId: string): TerminalOwnershipEffect {
  const attachment = state.attachments.get(attachmentId)
  if (!attachment?.connected) {
    return { emitOwnership: false }
  }
  if (state.controller?.attachmentId === attachmentId) {
    const sizeChanged = state.cols !== attachment.cols || state.rows !== attachment.rows
    const statusChanged = state.controller.status !== 'connected'
    if (statusChanged) state.controller = { attachmentId, status: 'connected' }
    return {
      resizeTo: sizeChanged ? { cols: attachment.cols, rows: attachment.rows } : undefined,
      emitOwnership: statusChanged && !sizeChanged,
    }
  }
  if (state.controller !== null || !state.allowImplicitAttachControl) {
    return { emitOwnership: false }
  }
  return claimTerminalAttachmentControl(state, attachmentId)
}

// Forcefully claims control for `attachmentId`, **preempting any existing
// controller** without checking the prior controller. The takeover path is
// the supported way for a non-controller attachment to gain control; do not
// call this from implicit auto-claim paths — those should funnel through
// `attachTerminalAttachment` / `updateTerminalAttachmentConnection`, which
// honor `allowImplicitAttachControl` and refuse when a different controller
// already holds the terminal.
export function claimTerminalAttachmentControl(
  state: TerminalOwnershipState,
  attachmentId: string,
): TerminalOwnershipEffect {
  const attachment = state.attachments.get(attachmentId)
  if (!attachment?.connected) return { emitOwnership: false }
  const sizeChanged = state.cols !== attachment.cols || state.rows !== attachment.rows
  state.controller = { attachmentId, status: 'connected' }
  state.allowImplicitAttachControl = false
  return {
    resizeTo: sizeChanged ? { cols: attachment.cols, rows: attachment.rows } : undefined,
    emitOwnership: !sizeChanged,
  }
}

// Reassigns control for the restart path. The caller is expected to
// have already validated authority via `decideTerminalActionAuthority`
// with action='restart', so by the time this runs the caller is the
// (sole) controller. We re-assert control here anyway because the
// session is being torn down and rebuilt — `state.controller` may
// have been cleared by the spawn failure path. If the attachment
// isn't connected we drop control rather than leave the session in a
// half-claimed state.
export function restartTerminalAttachmentControl(state: TerminalOwnershipState, attachmentId: string): void {
  state.controller = state.attachments.get(attachmentId)?.connected ? { attachmentId, status: 'connected' } : null
  if (state.controller) state.allowImplicitAttachControl = false
}

export function updateTerminalAttachmentConnection(
  state: TerminalOwnershipState,
  attachmentId: string,
  connected: boolean,
): TerminalOwnershipEffect {
  const attachment = state.attachments.get(attachmentId)
  if (!attachment) return { emitOwnership: false }
  const controllerStatus = connected ? 'connected' : 'grace'
  if (
    attachment.connected === connected &&
    (state.controller?.attachmentId !== attachmentId || state.controller?.status === controllerStatus)
  ) {
    return { emitOwnership: false }
  }
  attachment.connected = connected
  if (state.controller?.attachmentId !== attachmentId) {
    if (connected && state.controller === null && state.allowImplicitAttachControl) {
      return claimTerminalAttachmentControl(state, attachmentId)
    }
    return { emitOwnership: false }
  }
  if (state.controller?.status === controllerStatus) return { emitOwnership: false }
  state.controller = { attachmentId, status: controllerStatus as Exclude<TerminalControllerStatus, 'none'> }
  return { emitOwnership: true }
}

export function releaseTerminalAttachmentControl(state: TerminalOwnershipState, attachmentId: string): boolean {
  if (state.controller?.attachmentId !== attachmentId) return false
  if (state.attachments.get(attachmentId)?.connected) return false
  state.controller = null
  state.allowImplicitAttachControl = false
  state.attachments.delete(attachmentId)
  return true
}

export function expireTerminalAttachment(
  state: TerminalOwnershipState,
  attachmentId: string,
): TerminalAttachmentExpiryEffect {
  const attachment = state.attachments.get(attachmentId)
  if (!attachment || attachment.connected) return { emitOwnership: false, removed: false }
  const wasController = state.controller?.attachmentId === attachmentId
  if (wasController) {
    state.controller = null
    state.allowImplicitAttachControl = false
  }
  state.attachments.delete(attachmentId)
  return { emitOwnership: wasController, removed: true }
}
