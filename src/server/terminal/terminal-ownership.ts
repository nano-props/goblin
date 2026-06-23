import type { TerminalController } from '#/shared/terminal-types.ts'

/**
 * Per-action authority decisions.
 *
 * The model is owner-scoped: a single ownerId owns each session and
 * every attachment from that ownerId is considered the same logical
 * user. `write` and `resize` are restricted to whichever attachment
 * currently holds the controller slot — every other attachment is a
 * viewer. `takeover` is the one action that can preempt the existing
 * controller, and (in the renderer) it is the action the AuthorityGate
 * fires automatically when a viewer issues a write. `restart` reuses
 * the takeover path because the session is torn down and rebuilt;
 * callers without the controller must acquire control first.
 */
export type TerminalAuthorityAction = 'write' | 'resize' | 'restart' | 'takeover'

export type TerminalAuthorityReason = 'not-controller' | 'session-unowned' | 'unknown-attachment'

type TerminalAuthorityDecision = { kind: 'allow' } | { kind: 'deny'; reason: TerminalAuthorityReason }

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

function decideTerminalActionAuthority(
  state: TerminalOwnershipState,
  attachmentId: string,
  action: TerminalAuthorityAction,
): TerminalAuthorityDecision {
  const attachment = state.attachments.get(attachmentId)
  if (!attachment) return { kind: 'deny', reason: 'unknown-attachment' }
  if (action === 'takeover') return { kind: 'allow' }
  // write / resize / restart require the caller to currently hold
  // the controller slot.
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
  /**
   * Sticky owner-level claim. Set on the first successful attach or
   * explicit takeover for the session. Persists for the lifetime of
   * the session so a subsequent attach from a different attachmentId
   * can still auto-claim when no controller is present (e.g. the user
   * switched devices). The flag does NOT prevent takeover — it just
   * records "this owner has touched this session".
   */
  claimedByOwner: boolean
  cols: number
  rows: number
}

export interface TerminalOwnershipEffect {
  resizeTo?: { cols: number; rows: number }
  emitOwnership: boolean
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

/**
 * Called when an attachment issues `attach` (or `ensureSession` /
 * `create` with an attachmentId).
 *
 * Semantics (single-owner model):
 * - The same attachment reconnecting to a session it already
 *   controlled restores its controller slot if the slot was cleared
 *   while it was disconnected. (The server also clears the slot on
 *   disconnect, so this is the post-clear restore path.)
 * - If no controller is present, the attachment auto-claims. The
 *   `claimedByOwner` flag is set so a later attach from a different
 *   attachment can still auto-claim when the controller is empty.
 * - If a controller is already present and it isn't this attachment,
 *   the call returns without effect — the caller stays a viewer.
 */
export function attachTerminalAttachment(state: TerminalOwnershipState, attachmentId: string): TerminalOwnershipEffect {
  const attachment = state.attachments.get(attachmentId)
  if (!attachment?.connected) return { emitOwnership: false }

  if (state.controller?.attachmentId === attachmentId) {
    // Reattaching as the same attachment that previously controlled
    // (after a disconnect that cleared the slot). Promote back to
    // controller and adopt the latest geometry.
    const sizeChanged = state.cols !== attachment.cols || state.rows !== attachment.rows
    state.controller = { attachmentId, status: 'connected' }
    state.claimedByOwner = true
    return {
      resizeTo: sizeChanged ? { cols: attachment.cols, rows: attachment.rows } : undefined,
      emitOwnership: !sizeChanged,
    }
  }

  if (state.controller === null) {
    // No live controller: auto-claim. The owner has either touched
    // this session before (`claimedByOwner`) or is touching it for
    // the first time — both paths produce a controller here.
    return claimTerminalAttachmentControl(state, attachmentId)
  }
  return { emitOwnership: false }
}

/**
 * Forcefully claims control for `attachmentId`, preempting any
 * existing controller. This is the only path that can preempt; it
 * is what `takeoverSession` calls server-side, and (transitively)
 * what the renderer's AuthorityGate fires when a viewer issues a
 * write. Because the model is owner-scoped there is no cross-owner
 * ambiguity — every attachment from the session's ownerId is the
 * same user. The `claimedByOwner` flag is set on takeover so that
 * future disconnects don't strand the session.
 */
export function claimTerminalAttachmentControl(
  state: TerminalOwnershipState,
  attachmentId: string,
): TerminalOwnershipEffect {
  const attachment = state.attachments.get(attachmentId)
  if (!attachment?.connected) return { emitOwnership: false }
  const sizeChanged = state.cols !== attachment.cols || state.rows !== attachment.rows
  state.controller = { attachmentId, status: 'connected' }
  state.claimedByOwner = true
  return {
    resizeTo: sizeChanged ? { cols: attachment.cols, rows: attachment.rows } : undefined,
    emitOwnership: !sizeChanged,
  }
}

/**
 * Reassigns control for the restart path. The caller is expected to
 * have already validated authority via `isAuthoritative` with
 * action='restart', so by the time this runs the caller is the
 * (sole) controller. We re-assert control here anyway because the
 * session is being torn down and rebuilt — `state.controller` may
 * have been cleared by the spawn failure path. If the attachment
 * isn't connected we drop control rather than leave the session in a
 * half-claimed state.
 */
export function restartTerminalAttachmentControl(state: TerminalOwnershipState, attachmentId: string): void {
  state.controller = state.attachments.get(attachmentId)?.connected ? { attachmentId, status: 'connected' } : null
  if (state.controller) state.claimedByOwner = true
}

/**
 * Connection-state transition for a single attachment.
 *
 * Disconnect is immediate: the previous design kept the controller
 * slot in a 'grace' sub-state for 30 seconds so a transient network
 * blip wouldn't strand the controller. With owner-scoped auto-claim
 * + sticky `claimedByOwner`, that protection is no longer needed —
 * when the controller's attachment disconnects the slot clears,
 * and the next attach from any attachment auto-claims. A controller
 * that reconnects within milliseconds is still treated as the
 * controller (the `attachmentId` matches) and gets its slot back.
 *
 * On reconnect of an attachment that was previously the controller
 * (and whose slot was cleared while it was away), the slot is
 * restored. This is the post-disconnect restore path — it preserves
 * the previous design's "same attachmentId keeps control" invariant.
 */
export function updateTerminalAttachmentConnection(
  state: TerminalOwnershipState,
  attachmentId: string,
  connected: boolean,
): TerminalOwnershipEffect {
  const attachment = state.attachments.get(attachmentId)
  if (!attachment) return { emitOwnership: false }

  const wasConnected = attachment.connected
  attachment.connected = connected

  // Controller transition: connection state changed for whoever
  // currently holds the slot.
  if (state.controller?.attachmentId === attachmentId) {
    if (connected && !wasConnected) {
      // Came back online; emit so the renderer's viewer sees the
      // promotion. We already updated the connection flag above.
      return { emitOwnership: true }
    }
    if (!connected && wasConnected) {
      // Disconnected: clear the slot immediately. emitOwnership so
      // sibling viewers (including the disconnected tab if it ever
      // comes back) see controller=null.
      state.controller = null
      return { emitOwnership: true }
    }
    return { emitOwnership: false }
  }

  // Non-controller transition: only auto-claim on a fresh connect
  // when there's no live controller and the owner has touched this
  // session before. The first attach uses the same path via
  // `attachTerminalAttachment`, so we only reach here when the
  // attachment already exists in the map (e.g. a viewer coming
  // online) — in that case there is no slot to claim.
  if (connected && !wasConnected && state.controller === null && state.claimedByOwner) {
    return claimTerminalAttachmentControl(state, attachmentId)
  }
  return { emitOwnership: false }
}
