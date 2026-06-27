import type { TerminalController } from '#/shared/terminal-types.ts'

/**
 * Per-action authority decisions.
 *
 * The model is user-scoped: a single userId owns each session and
 * every attachment from that userId is considered the same logical
 * user. `write` and `resize` are restricted to whichever attachment
 * currently holds the controller role — every other attachment is a
 * viewer. `takeover` is the one action that can preempt the existing
 * controller, and (in the client) it is the action the AuthorityGate
 * fires automatically when a viewer issues a write. `restart` reuses
 * the takeover path because the session is torn down and rebuilt;
 * callers without the controller must acquire control first.
 */
export type TerminalAuthorityAction = 'write' | 'resize' | 'restart' | 'takeover'

export type TerminalAuthorityReason = 'not-controller' | 'session-unowned' | 'unknown-client'

type TerminalAuthorityDecision = { kind: 'allow' } | { kind: 'deny'; reason: TerminalAuthorityReason }

export function isAuthoritative(
  state: TerminalControllerState,
  clientId: string,
  action: TerminalAuthorityAction,
): boolean {
  return decideTerminalActionAuthority(state, clientId, action).kind === 'allow'
}

export function explainAuthority(
  state: TerminalControllerState,
  clientId: string,
  action: TerminalAuthorityAction,
): TerminalAuthorityReason | null {
  const decision = decideTerminalActionAuthority(state, clientId, action)
  return decision.kind === 'allow' ? null : decision.reason
}

function decideTerminalActionAuthority(
  state: TerminalControllerState,
  clientId: string,
  action: TerminalAuthorityAction,
): TerminalAuthorityDecision {
  const attachment = state.attachments.get(clientId)
  if (!attachment) return { kind: 'deny', reason: 'unknown-client' }
  if (action === 'takeover') return { kind: 'allow' }
  // write / resize / restart require the caller to currently hold
  // the controller role.
  if (state.controller === null) return { kind: 'deny', reason: 'session-unowned' }
  if (state.controller.clientId !== clientId) return { kind: 'deny', reason: 'not-controller' }
  return { kind: 'allow' }
}

/**
 * Per-client attachment state: the cols/rows this clientId last
 * reported and whether its socket is currently alive. The connection
 * flag is what the auto-claim / takeover paths gate on — an
 * attachment that disconnected cannot claim or hold the controller.
 */
export interface TerminalClientControllerState {
  cols: number
  rows: number
  connected: boolean
}

export interface TerminalControllerState {
  attachments: Map<string, TerminalClientControllerState>
  controller: TerminalController | null
  /**
   * Sticky user-level claim. Set on the first successful attach or
   * explicit takeover for the session. Persists for the lifetime of
   * the session so a subsequent attach from a different clientId
   * can still auto-claim when no controller is present (e.g. the
   * user switched devices). The flag does NOT prevent takeover — it
   * just records "this user has touched this session".
   */
  userSticky: boolean
  cols: number
  rows: number
}

export interface TerminalControllerEffect {
  resizeTo?: { cols: number; rows: number }
  emitIdentity: boolean
}

export function registerTerminalClient(
  state: TerminalControllerState,
  clientId: string,
  cols: number,
  rows: number,
  connected?: boolean,
): void {
  const existing = state.attachments.get(clientId)
  state.attachments.set(clientId, {
    cols,
    rows,
    connected: connected ?? existing?.connected ?? false,
  })
}

/**
 * Called when an attachment issues `attach` (or `ensureSession` /
 * `create` with an clientId).
 *
 * Semantics (single-user model):
 * - The same attachment reconnecting to a session it already
 *   controlled restores its controller role if the controller role was cleared
 *   while it was disconnected. (The server also clears the controller role on
 *   disconnect, so this is the post-clear restore path.)
 * - If no controller is present, the attachment auto-claims. The
 *   `userSticky` flag is set so a later attach from a different
 *   attachment can still auto-claim when the controller is empty.
 * - If a controller is already present and it isn't this attachment,
 *   the call returns without effect — the caller stays a viewer.
 */
export function attachTerminalClient(state: TerminalControllerState, clientId: string): TerminalControllerEffect {
  const attachment = state.attachments.get(clientId)
  if (!attachment?.connected) return { emitIdentity: false }

  if (state.controller?.clientId === clientId) {
    // Reattaching as the same attachment that previously controlled
    // (after a disconnect that cleared the controller role). Promote back to
    // controller and adopt the latest geometry.
    const sizeChanged = state.cols !== attachment.cols || state.rows !== attachment.rows
    state.controller = { clientId, status: 'connected' }
    state.userSticky = true
    return {
      resizeTo: sizeChanged ? { cols: attachment.cols, rows: attachment.rows } : undefined,
      emitIdentity: !sizeChanged,
    }
  }

  if (state.controller === null) {
    // No live controller: auto-claim. The user has either touched
    // this session before (`userSticky`) or is touching it for the
    // first time — both paths produce a controller here.
    return claimTerminalClientControl(state, clientId)
  }
  return { emitIdentity: false }
}

/**
 * Forcefully claims control for `clientId`, preempting any
 * existing controller. This is the only path that can preempt; it
 * is what `takeoverSession` calls server-side, and (transitively)
 * what the client's AuthorityGate fires when a viewer issues a
 * write. Because the model is user-scoped there is no cross-user
 * ambiguity — every attachment from the session's userId is the
 * same user. The `userSticky` flag is set on takeover so that
 * future disconnects don't strand the session.
 */
export function claimTerminalClientControl(state: TerminalControllerState, clientId: string): TerminalControllerEffect {
  const attachment = state.attachments.get(clientId)
  if (!attachment?.connected) return { emitIdentity: false }
  const sizeChanged = state.cols !== attachment.cols || state.rows !== attachment.rows
  state.controller = { clientId, status: 'connected' }
  state.userSticky = true
  return {
    resizeTo: sizeChanged ? { cols: attachment.cols, rows: attachment.rows } : undefined,
    emitIdentity: !sizeChanged,
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
export function restartTerminalClientControl(state: TerminalControllerState, clientId: string): void {
  state.controller = state.attachments.get(clientId)?.connected ? { clientId, status: 'connected' } : null
  if (state.controller) state.userSticky = true
}

/**
 * Connection-state transition for a single attachment.
 *
 * Disconnect is immediate: the previous design kept the controller
 * slot in a 'grace' sub-state for 30 seconds so a transient network
 * blip wouldn't strand the controller. With user-scoped auto-claim
 * + sticky `userSticky`, that protection is no longer needed —
 * when the controller's attachment disconnects the controller role clears,
 * and the next attach from any attachment auto-claims. A controller
 * that reconnects within milliseconds is still treated as the
 * controller (the `clientId` matches) and gets its slot back.
 *
 * On reconnect of an attachment that was previously the controller
 * (and whose controller role was cleared while it was away), the controller role is
 * restored. This is the post-disconnect restore path — it preserves
 * the previous design's "same clientId keeps control" invariant.
 */
export function updateTerminalClientConnection(
  state: TerminalControllerState,
  clientId: string,
  connected: boolean,
): TerminalControllerEffect {
  const attachment = state.attachments.get(clientId)
  if (!attachment) return { emitIdentity: false }

  const wasConnected = attachment.connected
  attachment.connected = connected

  // Controller transition: connection state changed for whoever
  // currently holds the controller role.
  if (state.controller?.clientId === clientId) {
    if (connected && !wasConnected) {
      // Came back online; emit so the client's viewer sees the
      // promotion. We already updated the connection flag above.
      return { emitIdentity: true }
    }
    if (!connected && wasConnected) {
      // Disconnected: clear the controller role immediately. emitIdentity so
      // sibling viewers (including the disconnected tab if it ever
      // comes back) see controller=null.
      state.controller = null
      return { emitIdentity: true }
    }
    return { emitIdentity: false }
  }

  // Non-controller transition: only auto-claim on a fresh connect
  // when there's no live controller and the user has touched this
  // session before. The first attach uses the same path via
  // `attachTerminalClient`, so we only reach here when the
  // attachment already exists in the map (e.g. a viewer coming
  // online) — in that case there is no slot to claim.
  if (connected && !wasConnected && state.controller === null && state.userSticky) {
    return claimTerminalClientControl(state, clientId)
  }
  return { emitIdentity: false }
}
