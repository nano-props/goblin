import { readOrCreateWebTerminalClientId } from '#/web/client-terminal-id.ts'
import { terminalLog } from '#/web/logger.ts'
import type { ClientTerminal } from '#/web/client-bridge-types.ts'
import type { TerminalTakeoverResult } from '#/shared/terminal-types.ts'

/**
 * `AuthorityGate` is the single source of truth for "can I write to
 * the terminal right now?" It is shared by every write path the
 * client exposes — xterm onData, paste, file drop, the manual
 * "接管" button — so the auto-promote behavior lives in one place
 * instead of being duplicated across call sites.
 *
 * Model (matches `src/server/terminal/terminal-controller.ts`):
 * the server is user-scoped. Every clientId from the same
 * userId is the same logical user. If the server believes the
 * caller is the controller, writes pass through; if the caller is
 * a viewer (someone else — including a sibling device — is
 * currently the controller), the gate issues an explicit takeover
 * round-trip first and then forwards the write. The result of the
 * promote is surfaced to the caller via `AuthorizationResult` so the
 * UI can show a toast on the rare failure path.
 *
 * The gate is intentionally synchronous for "is controller?": the
 * realtime identity event pushes role changes into `setRole`, and
 * read paths (`isController`, `canWrite`) just return the cached
 * value. The only async path is `authorize` / `takeover`, both of
 * which hit the client.
 */
/**
 * Reasons a write or takeover was denied. Surfaced to the UI so the
 * right toast can be shown (and to logs so the failure mode is
 * diagnosable from production).
 *
 * - `session-closed` — gate-internal: the runtime no longer has a
 *   terminalRuntimeSessionId, or the session was disposed mid-call. The takeover
 *   round-trip never started.
 * - `no-client` — gate-internal: the client bridge is unavailable
 *   (typically only in tests / startup). The takeover round-trip
 *   never started.
 * - `session-unknown` — the server reported the terminalRuntimeSessionId is not
 *   known to this user. The client session index is stale; the user
 *   needs to re-list before retrying.
 * - `client-offline` — the server's broker has no live socket
 *   for `(userId, clientId)`. The client is reconnecting.
 *   Retrying after a moment usually works.
 * - `takeover-rejected` — catch-all for any other server-side
 *   refusal (size out of range, validator rejection, etc.). The
 *   `message` field carries the server's i18n key.
 */
export type AuthorizationDenialReason =
  | 'session-closed'
  | 'no-client'
  | 'session-unknown'
  | 'client-offline'
  | 'takeover-rejected'

export type AuthorizationResult =
  | { kind: 'allowed' }
  | { kind: 'promoted' }
  | { kind: 'denied'; reason: AuthorizationDenialReason; message?: string }

export interface TerminalAuthorityGate {
  /** True when the cached role says we're the controller. */
  isController(): boolean
  /**
   * True when we can write — either we're the controller already, or
   * we know we're a viewer and the gate will auto-promote on the
   * next `authorize` call. False only while the session is unowned
   * AND we haven't even attached yet.
   */
  canWrite(): boolean
  /**
   * Pre-write hook. Returns `allowed` when we're already the
   * controller (writes may proceed without a server round-trip).
   * Returns `promoted` after a successful viewer→controller
   * takeover (the caller should now retry or proceed with the
   * write). Returns `denied` when the session vanished or the
   * takeover was rejected.
   */
  authorize(action: 'write' | 'resize'): Promise<AuthorizationResult>
  /**
   * Explicit takeover — used by the 接管 button, by keyboard
   * shortcuts, and by any other "I want control right now" path.
   * Internal callers go through `authorize` for write/resize so the
   * promote + retry pattern stays centralized.
   *
   * Returns the structured outcome (an `AuthorizationResult` with
   * only `allowed` or `denied` in practice — `promoted` is
   * write-specific) so the caller can surface a specific toast for
   * the failure mode and log the server's i18n key.
   */
  takeover(): Promise<Exclude<AuthorizationResult, { kind: 'promoted' }>>
  /**
   * Push the latest role the server believes this clientId has.
   * Called by the realtime identity event handler in
   * `TerminalSession.handleIdentity`.
   */
  setRole(role: 'controller' | 'viewer' | 'unowned'): void
  /**
   * Current cached role (last value fed to `setRole`). For tests
   * and diagnostic surfaces; production code should branch on
   * `isController` / `canWrite` instead.
   */
  currentRole(): 'controller' | 'viewer' | 'unowned'
}

interface XtermAuthorityGateOptions {
  bridge: ClientTerminal
  resolveSize: () => Promise<{ cols: number; rows: number }>
  /**
   * Non-throwing predicate: returns true while the session is
   * still the one this gate belongs to and the parent hasn't been
   * disposed. Used to short-circuit `doTakeover` if the session
   * vanished between the caller queuing a keystroke and the client
   * round-trip resolving. The previous name `assertSessionAlive`
   * was misleading — this never throws, it just returns false.
   */
  isSessionAlive: (terminalRuntimeSessionId: string) => boolean
  getTerminalRuntimeSessionId: () => string | null
  /** Called after a successful auto-promote so the caller can apply
   *  the post-takeover frame (similar to `applyTakeover` on the
   *  runtime) without coupling the gate to the runtime type. */
  onPromoted?: (result: TerminalTakeoverResult) => void
}

/**
 * Default implementation. One instance per `TerminalSession`
 * — the projection constructs them when a session becomes active.
 */
export function createXtermAuthorityGate(opts: XtermAuthorityGateOptions): TerminalAuthorityGate {
  let role: 'controller' | 'viewer' | 'unowned' = 'unowned'

  function readClientId(): string {
    return readOrCreateWebTerminalClientId()
  }

  return {
    isController: () => role === 'controller',
    canWrite: () => role === 'controller' || role === 'viewer',
    currentRole: () => role,

    setRole(next) {
      role = next
    },

    async authorize(_action) {
      if (role === 'controller') return { kind: 'allowed' }
      if (role === 'unowned') return { kind: 'denied', reason: 'session-closed' }
      // role === 'viewer': auto-promote
      const takeover = await doTakeover()
      if (takeover.kind === 'allowed') return { kind: 'promoted' }
      return takeover
    },

    async takeover() {
      // `doTakeover` only ever returns `allowed` or `denied` —
      // `promoted` is `authorize` only. The `takeover` interface
      // narrows the public type to match.
      return (await doTakeover()) as Exclude<AuthorizationResult, { kind: 'promoted' }>
    },
  }

  /**
   * Single deny-path helper: emits a structured `warn` (so ops can
   * correlate with the i18n key in the `message` field) and returns
   * the matching `AuthorizationResult`. The `stage` tag is the only
   * diagnostic the helper adds — it tells the operator which step
   * in the takeover pipeline produced the denial (preflight /
   * resolveSize / client / server) without forcing the call site
   * to invent a new log message per branch.
   */
  function deny(
    reason: AuthorizationDenialReason,
    stage: string,
    extra: { terminalRuntimeSessionId?: string; message?: string; err?: unknown } = {},
  ): { kind: 'denied'; reason: AuthorizationDenialReason; message?: string } {
    terminalLog.warn('authority gate: takeover denied', {
      reason,
      stage,
      ...(extra.terminalRuntimeSessionId !== undefined ? { terminalRuntimeSessionId: extra.terminalRuntimeSessionId } : {}),
      ...(extra.message !== undefined ? { message: extra.message } : {}),
      ...(extra.err !== undefined ? { err: extra.err } : {}),
    })
    return extra.message !== undefined ? { kind: 'denied', reason, message: extra.message } : { kind: 'denied', reason }
  }

  async function doTakeover(): Promise<AuthorizationResult> {
    const terminalRuntimeSessionId = opts.getTerminalRuntimeSessionId()
    if (!terminalRuntimeSessionId) return deny('session-closed', 'preflight')
    if (!opts.isSessionAlive(terminalRuntimeSessionId)) return deny('session-closed', 'isSessionAlive', { terminalRuntimeSessionId })
    let size: { cols: number; rows: number }
    try {
      size = await opts.resolveSize()
    } catch (err) {
      return deny('takeover-rejected', 'resolveSize', { terminalRuntimeSessionId, err })
    }
    let result: TerminalTakeoverResult
    try {
      result = await opts.bridge.takeover({
        terminalRuntimeSessionId,
        cols: size.cols,
        rows: size.rows,
        clientId: readClientId(),
      })
    } catch (err) {
      return deny('no-client', 'client', { terminalRuntimeSessionId, err })
    }
    if (!result.ok) {
      return deny(classifyTakeoverRejection(result.message), 'server', {
        terminalRuntimeSessionId,
        message: result.message,
      })
    }
    // Post-await dispose guard: the client's takeover round-trip
    // can resolve after the session was disposed (e.g. the user
    // navigated away mid-takeover). Without this re-check the
    // `onPromoted` callback would mutate a destroyed runtime and
    // flip the gate's role to `controller`, leaving stale state
    // for the next sibling attach on the same `terminalRuntimeSessionId`.
    if (!opts.isSessionAlive(terminalRuntimeSessionId)) {
      return deny('session-closed', 'post-await isSessionAlive', { terminalRuntimeSessionId })
    }
    // ORDERING CONTRACT: `onPromoted` MUST run before `role` is
    // flipped to 'controller'. Callers of `takeover()` /
    // `authorize('write')` rely on the post-call `canWrite()`
    // returning true without a separate realtime identity event.
    // The runtime's `applyTakeover` (wired through `onPromoted`)
    // updates the runtime's controller cache synchronously, so by
    // the time the gate sets `role = 'controller'`, both layers
    // agree. Moving the assignment above `onPromoted` (or deferring
    // it past the await chain) would break the round-trip-free
    // recovery path that lets a viewer type into a fresh keystroke
    // and have it land without seeing a transient "denied".
    opts.onPromoted?.(result)
    role = 'controller'
    return { kind: 'allowed' }
  }
}

/**
 * Classify a server-side takeover rejection message into a UI-friendly
 * reason. The server returns i18n keys; only two are used in the
 * takeover failure paths today (`error.unavailable` for the
 * "attachment not connected" path, and `error.invalid-arguments`
 * for everything else, including unknown session/attachment). The
 * catch-all `takeover-rejected` is preserved so a future server
 * message key can land without a client change.
 */
function classifyTakeoverRejection(message: string): AuthorizationDenialReason {
  if (message === 'error.unavailable') return 'client-offline'
  if (message === 'error.invalid-arguments') return 'session-unknown'
  return 'takeover-rejected'
}
