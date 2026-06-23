import { readOrCreateWebTerminalAttachmentId } from '#/web/renderer-terminal-bridge.ts'
import { terminalLog } from '#/web/logger.ts'
import type { RendererTerminalBridge } from '#/web/renderer-bridge-types.ts'
import type { TerminalTakeoverResult } from '#/shared/terminal-types.ts'

/**
 * `AuthorityGate` is the single source of truth for "can I write to
 * the terminal right now?" It is shared by every write path the
 * renderer exposes — xterm onData, paste, file drop, the manual
 * "接管" button — so the auto-promote behavior lives in one place
 * instead of being duplicated across call sites.
 *
 * Model (matches `src/server/terminal/terminal-ownership.ts`):
 * the server is owner-scoped. Every attachmentId from the same
 * ownerId is the same logical user. If the server believes the
 * caller is the controller, writes pass through; if the caller is
 * a viewer (someone else — including a sibling device — is
 * currently the controller), the gate issues an explicit takeover
 * round-trip first and then forwards the write. The result of the
 * promote is surfaced to the caller via `AuthorizationResult` so the
 * UI can show a toast on the rare failure path.
 *
 * The gate is intentionally synchronous for "is controller?": the
 * realtime ownership event pushes role changes into `setRole`, and
 * read paths (`isController`, `canWrite`) just return the cached
 * value. The only async path is `authorize` / `takeover`, both of
 * which hit the bridge.
 */
export type AuthorizationResult =
  | { kind: 'allowed' }
  | { kind: 'promoted' }
  | { kind: 'denied'; reason: 'session-closed' | 'no-bridge' | 'takeover-rejected' }

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
   */
  takeover(): Promise<boolean>
  /**
   * Push the latest role the server believes this attachmentId has.
   * Called by the realtime ownership event handler in
   * `ManagedTerminalSession.handleOwnership`.
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
  bridge: RendererTerminalBridge
  resolveSize: () => Promise<{ cols: number; rows: number }>
  /**
   * Non-throwing predicate: returns true while the session is
   * still the one this gate belongs to and the parent hasn't been
   * disposed. Used to short-circuit `doTakeover` if the session
   * vanished between the caller queuing a keystroke and the bridge
   * round-trip resolving. The previous name `assertSessionAlive`
   * was misleading — this never throws, it just returns false.
   */
  isSessionAlive: (sessionId: string) => boolean
  getSessionId: () => string | null
  /** Called after a successful auto-promote so the caller can apply
   *  the post-takeover frame (similar to `applyTakeover` on the
   *  runtime) without coupling the gate to the runtime type. */
  onPromoted?: (result: TerminalTakeoverResult) => void
}

/**
 * Default implementation. One instance per `ManagedTerminalSession`
 * — the registry constructs them when a session becomes active.
 */
export function createXtermAuthorityGate(opts: XtermAuthorityGateOptions): TerminalAuthorityGate {
  let role: 'controller' | 'viewer' | 'unowned' = 'unowned'

  function readAttachmentId(): string {
    return readOrCreateWebTerminalAttachmentId()
  }

  return {
    isController: () => role === 'controller',
    canWrite: () => role === 'controller' || role === 'viewer',
    currentRole: () => role,

    setRole(next) {
      role = next
    },

    async authorize(action) {
      if (role === 'controller') return { kind: 'allowed' }
      if (role === 'unowned') return { kind: 'denied', reason: 'session-closed' }
      // role === 'viewer': auto-promote
      const promoted = await doTakeover()
      return promoted ? { kind: 'promoted' } : { kind: 'denied', reason: 'takeover-rejected' }
    },

    async takeover() {
      return await doTakeover()
    },
  }

  async function doTakeover(): Promise<boolean> {
    const sessionId = opts.getSessionId()
    if (!sessionId) return false
    if (!opts.isSessionAlive(sessionId)) return false
    let size: { cols: number; rows: number }
    try {
      size = await opts.resolveSize()
    } catch (err) {
      terminalLog.warn('authority gate: failed to resolve size for takeover', { sessionId, err })
      return false
    }
    let result: TerminalTakeoverResult
    try {
      result = await opts.bridge.takeover({
        sessionId,
        cols: size.cols,
        rows: size.rows,
        attachmentId: readAttachmentId(),
      })
    } catch (err) {
      terminalLog.warn('authority gate: takeover bridge call threw', { sessionId, err })
      return false
    }
    if (!result.ok) {
      terminalLog.warn('authority gate: takeover rejected by server', { sessionId, message: result.message })
      return false
    }
    // ORDERING CONTRACT: `onPromoted` MUST run before `role` is
    // flipped to 'controller'. Callers of `takeover()` /
    // `authorize('write')` rely on the post-call `canWrite()`
    // returning true without a separate realtime ownership event.
    // The runtime's `applyTakeover` (wired through `onPromoted`)
    // updates the runtime's controller cache synchronously, so by
    // the time the gate sets `role = 'controller'`, both layers
    // agree. Moving the assignment above `onPromoted` (or deferring
    // it past the await chain) would break the round-trip-free
    // recovery path that lets a viewer type into a fresh keystroke
    // and have it land without seeing a transient "denied".
    opts.onPromoted?.(result)
    role = 'controller'
    return true
  }
}
