import crypto from 'node:crypto'
import path from 'node:path'
import {
  type TerminalAttachResult,
  type TerminalController,
  type TerminalExitEvent,
  type TerminalIdentityEvent,
  type TerminalLifecycleEvent,
  type TerminalOutputEvent,
  type TerminalSessionSnapshot,
  type TerminalSessionSummary,
  type TerminalTakeoverResult,
} from '#/shared/terminal-types.ts'
import { isValidTerminalPtySessionId, normalizeTerminalSize } from '#/shared/terminal-validators.ts'
import { parseTerminalWorkspaceSlotKey } from '#/shared/terminal-workspace-slot-key.ts'
import type { TerminalSessionOrderRuntime } from '#/server/terminal/terminal-session-order-runtime.ts'
import {
  attachTerminalClient,
  claimTerminalClientControl,
  effectiveTerminalController,
  explainAuthority,
  isAuthoritative,
  registerTerminalClient,
  restartTerminalClientControl,
  terminalIdentityChanged,
  type TerminalClientControllerState,
} from '#/server/terminal/terminal-controller.ts'
import {
  createEmptyTerminalRenderState,
  replaySnapshot,
  takeSnapshot,
} from '#/server/terminal/terminal-render-state.ts'
import { markTerminalSessionClosed, markTerminalSessionError } from '#/server/terminal/terminal-session-lifecycle.ts'
import { TerminalPtyBinding, type TerminalPtySessionState } from '#/server/terminal/terminal-session-pty-lifecycle.ts'
import type { PtySupervisor } from '#/server/terminal/pty-supervisor.ts'

const MAX_TERMINAL_WRITE_CHARS = 1024 * 1024

type TerminalSessionOrderRuntimeLike<TUser extends string | number> = Pick<
  TerminalSessionOrderRuntime<TUser>,
  'registerTerminalSessionOrder' | 'unregisterTerminalSessionOrder' | 'sessionDisplayOrder'
>

interface TerminalPtyAttachResult {
  generation: number
  result: TerminalAttachResult
}

export interface TerminalEnsureSessionInput<TUser extends string | number> {
  userId: TUser
  scope: string
  terminalKey: string
  cwd: string
  cols: number
  rows: number
  clientId?: string
  forceNew?: boolean
  command?: string
  args?: string[]
  startupShellCommand?: string
  env?: Record<string, string>
}

interface TerminalSessionView<TUser extends string | number> extends TerminalPtySessionState<TUser> {
  scope: string
  terminalKey: string
  worktreePath: string
  ptyBinding: TerminalPtyBinding<TerminalSessionView<TUser>>
  attachments: Map<string, TerminalClientControllerState>
  controllerClientId: string | null
  /**
   * Sticky user-level claim. Once any attachment from this session's
   * user has successfully attached or taken over, this stays set
   * for the lifetime of the session so a subsequent attach from a
   * different clientId (e.g. switching devices) can still
   * auto-claim when no controller is alive.
   */
  userSticky: boolean
  /** Mirrors the client's `takeoverPending` flag so a lifecycle
   *  realtime event can tell siblings to disable the write path
   *  the moment the takeover starts. */
  takeoverPending: boolean
}

export interface TerminalEventSink<TUser extends string | number> {
  onOutput(userId: TUser, event: TerminalOutputEvent): void
  onTitle?(userId: TUser, event: { ptySessionId: string; canonicalTitle: string | null }): void
  onExit(userId: TUser, event: TerminalExitEvent): void
  // Identity and lifecycle are emitted on separate channels so the
  // client's teardown decision can subscribe to identity only.
  // A transitional phase update arrives as `onLifecycle` and never
  // looks like a role change.
  onIdentity?(userId: TUser, event: TerminalIdentityEvent): void
  onLifecycle?(userId: TUser, event: TerminalLifecycleEvent): void
}

export class TerminalSessionManager<TUser extends string | number> {
  private readonly sessionsByPtySessionId = new Map<string, TerminalSessionView<TUser>>()
  private readonly ptySessionIdByUserTerminalKey = new Map<string, string>()
  private readonly sink: TerminalEventSink<TUser>
  private readonly ptySupervisor: PtySupervisor
  private readonly terminalSessionOrder: TerminalSessionOrderRuntimeLike<TUser>
  private readonly isClientOnline: (userId: TUser, clientId: string) => boolean

  constructor(
    ptySupervisor: PtySupervisor,
    sink: TerminalEventSink<TUser>,
    terminalSessionOrder: TerminalSessionOrderRuntimeLike<TUser>,
    isClientOnline: (userId: TUser, clientId: string) => boolean,
  ) {
    this.ptySupervisor = ptySupervisor
    this.sink = sink
    this.terminalSessionOrder = terminalSessionOrder
    this.isClientOnline = isClientOnline
  }

  async ensureSession(input: TerminalEnsureSessionInput<TUser>): Promise<TerminalAttachResult> {
    const size = normalizeTerminalSize(input.cols, input.rows)
    if (!size) return { ok: false, message: 'error.invalid-arguments' }

    const cwd = path.resolve(input.cwd)
    const userId = input.userId
    if (!this.isValidUserId(userId)) return { ok: false, message: 'error.invalid-arguments' }
    const userKey = this.userTerminalKey(userId, input.terminalKey)
    if (input.forceNew) this.closeUserTerminalKey(userId, input.terminalKey)
    const existingId = this.ptySessionIdByUserTerminalKey.get(userKey)
    const existing = existingId ? this.sessionsByPtySessionId.get(existingId) : undefined
    if (existing) {
      this.terminalSessionOrder.registerTerminalSessionOrder({
        userId,
        scope: existing.scope,
        worktreePath: existing.worktreePath,
        id: existing.terminalKey,
      })
      if (input.clientId) {
        registerTerminalClient(existing, input.clientId, size.cols, size.rows)
      }
      return await this.attachExistingSession(existing, input.clientId)
    }

    const worktreePath = parseWorktreePathFromTerminalKey(input.terminalKey) ?? input.terminalKey
    const id = createPtySessionId()
    const session: TerminalSessionView<TUser> = {
      id,
      userId,
      scope: input.scope,
      terminalKey: input.terminalKey,
      worktreePath,
      cwd,
      command: input.command,
      args: input.args,
      startupShellCommand: input.startupShellCommand,
      env: input.env,
      cols: size.cols,
      rows: size.rows,
      render: createEmptyTerminalRenderState(size.cols, size.rows),
      ptyBinding: this.createPtyBinding(),
      attachments: new Map(),
      controllerClientId: null,
      userSticky: false,
      phase: 'opening',
      message: null,
      // Travel on the lifecycle realtime event so a takeover
      // pending flag set on one tab can immediately disable the
      // write path on the others without an identity round-trip.
      takeoverPending: false,
    }
    this.sessionsByPtySessionId.set(id, session)
    this.ptySessionIdByUserTerminalKey.set(userKey, id)
    this.terminalSessionOrder.registerTerminalSessionOrder({
      userId,
      scope: input.scope,
      worktreePath,
      id: input.terminalKey,
    })
    if (input.clientId) {
      registerTerminalClient(session, input.clientId, size.cols, size.rows)
      this.applyIdentityEffect(session, attachTerminalClient(session, input.clientId, this.sessionPresence(session)))
    }
    const spawn = await this.spawnAndAttachSession(session)
    if (!spawn.result.ok) {
      // Spawn failed: do not leave a zombie session in the maps. The
      // catalog would otherwise find it on retry and surface it as a
      // successful attach with an empty buffer and a null pty — i.e.
      // a blank, non-responsive terminal. `closeSession` removes the
      // map entry and frees pty/listener resources via the standard
      // disposal path. Stale spawns are different: another close/restart
      // generation already owns the session, so this caller must not tear
      // down the current generation.
      if (session.ptyBinding.isCurrentSpawn(session, spawn.generation)) this.closeSession(id)
      return spawn.result
    }
    return spawn.result
  }

  writeSession(userId: TUser, ptySessionId: string, data: string, clientId: string): boolean {
    if (!isValidTerminalPtySessionId(ptySessionId) || !isValidTerminalWriteData(data)) return false
    const session = this.getSession(userId, ptySessionId)
    if (!session?.ptyBinding.hasPty()) return false
    if (session.phase !== 'open') return false
    // Register the attachment first so a brand-new socket can satisfy
    // the unknown-attachment gate, then defer to the shared
    // authority helper so write/resize/restart stay in lockstep.
    registerTerminalClient(session, clientId, session.cols, session.rows)
    if (!isAuthoritative(session, clientId, 'write', this.sessionPresence(session))) return false
    return session.ptyBinding.write(session, data)
  }

  async attachSession(
    userId: TUser,
    ptySessionId: string,
    cols: number,
    rows: number,
    clientId: string,
  ): Promise<TerminalAttachResult> {
    if (!isValidTerminalPtySessionId(ptySessionId)) return { ok: false, message: 'error.invalid-arguments' }
    const size = normalizeTerminalSize(cols, rows)
    if (!size) return { ok: false, message: 'error.invalid-arguments' }
    const session = this.getSession(userId, ptySessionId)
    if (!session) return { ok: false, message: 'error.invalid-arguments' }
    registerTerminalClient(session, clientId, size.cols, size.rows)
    const pending = await session.ptyBinding.waitForPendingSpawn(session)
    if (pending) return pending
    if (!this.isLiveSession(session)) return { ok: false, message: 'error.unavailable' }
    this.applyIdentityEffect(session, attachTerminalClient(session, clientId, this.sessionPresence(session)))
    return await this.attachResult(session)
  }

  resizeSession(userId: TUser, ptySessionId: string, cols: number, rows: number, clientId: string): boolean {
    if (!isValidTerminalPtySessionId(ptySessionId)) return false
    const size = normalizeTerminalSize(cols, rows)
    if (!size) return false
    const session = this.getSession(userId, ptySessionId)
    if (!session) return false
    registerTerminalClient(session, clientId, size.cols, size.rows)
    if (!isAuthoritative(session, clientId, 'resize', this.sessionPresence(session))) return false
    return this.resizeSessionPty(session, size.cols, size.rows)
  }

  takeoverSession(
    userId: TUser,
    ptySessionId: string,
    cols: number,
    rows: number,
    clientId: string,
  ): TerminalTakeoverResult {
    if (!isValidTerminalPtySessionId(ptySessionId)) return { ok: false, message: 'error.invalid-arguments' }
    const size = normalizeTerminalSize(cols, rows)
    if (!size) return { ok: false, message: 'error.invalid-arguments' }
    const session = this.getSession(userId, ptySessionId)
    if (!session) return { ok: false, message: 'error.invalid-arguments' }
    registerTerminalClient(session, clientId, size.cols, size.rows)
    if (!isAuthoritative(session, clientId, 'takeover', this.sessionPresence(session))) {
      return { ok: false, message: 'error.invalid-arguments' }
    }
    const effect = claimTerminalClientControl(session, clientId, this.sessionPresence(session))
    this.applyIdentityEffect(session, effect)
    if (!effect.emitIdentity && !effect.resizeTo) {
      return { ok: false, message: 'error.unavailable' }
    }
    return this.takeoverResult(session)
  }

  async restartSession(
    userId: TUser,
    ptySessionId: string,
    cols: number,
    rows: number,
    clientId: string,
  ): Promise<TerminalAttachResult> {
    if (!isValidTerminalPtySessionId(ptySessionId)) return { ok: false, message: 'error.invalid-arguments' }
    const size = normalizeTerminalSize(cols, rows)
    if (!size) return { ok: false, message: 'error.invalid-arguments' }
    const session = this.getSession(userId, ptySessionId)
    if (!session) return { ok: false, message: 'error.invalid-arguments' }
    registerTerminalClient(session, clientId, size.cols, size.rows)
    const denyReason = explainAuthority(session, clientId, 'restart', this.sessionPresence(session))
    if (denyReason !== null) {
      return { ok: false, message: authorityReasonToMessage(denyReason) }
    }
    restartTerminalClientControl(session, clientId, this.sessionPresence(session))
    this.resetSessionState(session, size.cols, size.rows, 'restarting')
    const spawn = await this.spawnAndAttachSession(session)
    if (!spawn.result.ok && session.ptyBinding.isCurrentSpawn(session, spawn.generation)) {
      if (markTerminalSessionError(session, spawn.result.message)) this.emitLifecycle(session)
    }
    return spawn.result
  }

  closeSessionForUser(userId: TUser, ptySessionId: string): boolean {
    if (!this.getSession(userId, ptySessionId)) return false
    this.closeSession(ptySessionId)
    return true
  }

  closeSession(ptySessionId: string): void {
    const session = this.sessionsByPtySessionId.get(ptySessionId)
    if (!session) return
    session.ptyBinding.invalidateOwnership()
    if (markTerminalSessionClosed(session)) this.emitLifecycle(session)
    this.sessionsByPtySessionId.delete(ptySessionId)
    const userKey = this.userTerminalKey(session.userId, session.terminalKey)
    if (this.ptySessionIdByUserTerminalKey.get(userKey) === ptySessionId)
      this.ptySessionIdByUserTerminalKey.delete(userKey)
    this.terminalSessionOrder.unregisterTerminalSessionOrder({
      userId: session.userId,
      scope: session.scope,
      worktreePath: session.worktreePath,
      id: session.terminalKey,
    })
    session.ptyBinding.dispose(session)
  }

  closeSessionsForUser(userId: TUser): void {
    for (const session of Array.from(this.sessionsByPtySessionId.values())) {
      if (session.userId === userId) this.closeSession(session.id)
    }
  }

  handleClientPresenceChanged(userId: TUser, clientId: string, previousOnline: boolean): void {
    for (const session of Array.from(this.sessionsByPtySessionId.values())) {
      if (session.userId !== userId) continue
      if (!session.attachments.has(clientId) && session.controllerClientId !== clientId) continue
      const previousController = this.effectiveControllerWithOverride(session, clientId, previousOnline)
      if (terminalIdentityChanged(session, previousController, this.sessionPresence(session)))
        this.emitIdentity(session)
    }
  }

  closeAll(): void {
    for (const ptySessionId of Array.from(this.sessionsByPtySessionId.keys())) this.closeSession(ptySessionId)
  }

  async getSessionSnapshot(userId: TUser, ptySessionId: string): Promise<TerminalSessionSnapshot | null> {
    const session = this.getSession(userId, ptySessionId)
    if (!session) return null
    const snap = await takeSnapshot(session.render)
    if (!snap) return null
    return { ptySessionId, snapshot: snap.snapshot, snapshotSeq: snap.snapshotSeq }
  }

  async listSessionsForUser(userId: TUser, scope: string): Promise<TerminalSessionSummary[]> {
    const sessions: TerminalSessionSummary[] = []
    for (const session of Array.from(this.sessionsByPtySessionId.values())) {
      if (session.userId === userId && session.scope === scope) {
        sessions.push({
          ptySessionId: session.id,
          terminalKey: session.terminalKey,
          cwd: session.cwd,
          controller: this.effectiveController(session),
          processName: session.ptyBinding.processName(),
          canonicalTitle: session.render.title,
          phase: session.phase,
          message: session.message,
          cols: session.cols,
          rows: session.rows,
          displayOrder: this.terminalSessionDisplayOrder(session),
        })
      }
    }
    sessions.sort((a, b) => a.displayOrder - b.displayOrder)
    return sessions
  }

  getSessionScope(userId: TUser, ptySessionId: string): string | undefined {
    return this.getSession(userId, ptySessionId)?.scope
  }

  // T4.1: aggregate replay-buffer stats across all live sessions, for
  // exposure via `ServerTerminalHost.getDiagnostics()`. The raw buffer is
  // no longer the reattach source of truth, but it still drives the
  // authoritative memory number for retained PTY output. The char count is
  // a close approximation of bytes for terminal output (mostly ASCII); full
  // UTF-16 byte count would be `buffer.length * 2` and is an upper bound.
  getSessionBufferStats(): { count: number; totalBufferChars: number; maxBufferChars: number } {
    let count = 0
    let totalBufferChars = 0
    let maxBufferChars = 0
    for (const session of this.sessionsByPtySessionId.values()) {
      count += 1
      const chars = session.render.buffer.length
      totalBufferChars += chars
      if (chars > maxBufferChars) maxBufferChars = chars
    }
    return { count, totalBufferChars, maxBufferChars }
  }

  private closeUserTerminalKey(userId: TUser, terminalKey: string): void {
    const id = this.ptySessionIdByUserTerminalKey.get(this.userTerminalKey(userId, terminalKey))
    if (id) this.closeSession(id)
  }

  private terminalSessionDisplayOrder(session: TerminalSessionView<TUser>): number {
    return (
      this.terminalSessionOrder.sessionDisplayOrder({
        userId: session.userId,
        scope: session.scope,
        worktreePath: session.worktreePath,
        id: session.terminalKey,
      }) ?? Number.MAX_SAFE_INTEGER
    )
  }

  // Sends SIGWINCH to the child PTY and queues the same geometry change
  // into the server-side headless xterm state. The shell's repaint still
  // arrives through the regular `onData` path, but snapshots taken during
  // the transition are serialized from a screen model with the canonical
  // dimensions instead of replaying raw historical bytes into the client.
  // The client reports fitted xterm geometry, but this accepted resize is
  // where that view measurement becomes server-owned canonical geometry.
  private resizeSessionPty(session: TerminalSessionView<TUser>, cols: number, rows: number): boolean {
    const changed = session.cols !== cols || session.rows !== rows
    const resized = session.ptyBinding.resize(session, cols, rows)
    if (resized && changed) this.emitIdentity(session)
    return resized
  }

  private takeoverResult(session: TerminalSessionView<TUser>): TerminalTakeoverResult {
    // By the time we get here, `applyIdentityEffect` has already
    // executed in `takeoverSession()` — the requesting attachment
    // is the controller and `session.cols`/`session.rows` reflect
    // any resize effect that ran during the control claim. We
    // surface all four frame fields synchronously so the client
    // doesn't have to wait for a follow-up realtime `identity`
    // event before painting the post-takeover frame. See
    // `docs/terminal-session-lifecycle.md` §Takeover atomicity.
    return {
      ok: true,
      ptySessionId: session.id,
      role: 'controller',
      controllerStatus: 'connected',
      controller: this.effectiveController(session),
      canonicalCols: session.cols,
      canonicalRows: session.rows,
      phase: session.phase,
    }
  }

  private async attachResult(session: TerminalSessionView<TUser>): Promise<TerminalAttachResult> {
    const snap = await replaySnapshot(session.render)
    if (!snap) return { ok: false, message: 'error.unavailable' }
    return {
      ok: true,
      ptySessionId: session.id,
      snapshot: snap.snapshot,
      snapshotSeq: snap.snapshotSeq,
      processName: session.ptyBinding.processName(),
      canonicalTitle: session.render.title,
      phase: session.phase,
      message: session.message,
      controller: this.effectiveController(session),
      canonicalCols: session.cols,
      canonicalRows: session.rows,
    }
  }

  private async attachExistingSession(
    session: TerminalSessionView<TUser>,
    clientId: string | undefined,
  ): Promise<TerminalAttachResult> {
    const pending = await session.ptyBinding.waitForPendingSpawn(session)
    if (pending) return pending
    if (!this.isLiveSession(session)) return { ok: false, message: 'error.unavailable' }
    if (clientId)
      this.applyIdentityEffect(session, attachTerminalClient(session, clientId, this.sessionPresence(session)))
    return await this.attachResult(session)
  }

  private userTerminalKey(userId: TUser, terminalKey: string): string {
    return `${String(userId)}\0${terminalKey}`
  }

  private sessionPresence(session: TerminalSessionView<TUser>): (clientId: string) => boolean {
    return (clientId) => this.isClientOnline(session.userId, clientId)
  }

  private effectiveController(session: TerminalSessionView<TUser>): TerminalController | null {
    return effectiveTerminalController(session, this.sessionPresence(session))
  }

  private effectiveControllerWithOverride(
    session: TerminalSessionView<TUser>,
    changedClientId: string,
    changedClientOnline: boolean,
  ): TerminalController | null {
    return effectiveTerminalController(session, (clientId) =>
      clientId === changedClientId ? changedClientOnline : this.isClientOnline(session.userId, clientId),
    )
  }

  private emitIdentity(session: TerminalSessionView<TUser>): void {
    this.sink.onIdentity?.(session.userId, {
      ptySessionId: session.id,
      controller: this.effectiveController(session),
      canonicalCols: session.cols,
      canonicalRows: session.rows,
    })
  }

  // Lifecycle emits a single, identity-free event whenever the
  // session's phase, message, or takeover-pending flag changes. A
  // controller→viewer teardown decision in the client must not
  // subscribe to this channel; the wire keeps the two concerns on
  // separate paths so the type-level separation in the client
  // (`applyIdentity` vs `applyLifecycle`) cannot be circumvented.
  private emitLifecycle(session: TerminalSessionView<TUser>): void {
    this.sink.onLifecycle?.(session.userId, {
      ptySessionId: session.id,
      phase: session.phase,
      message: session.message,
      takeoverPending: session.takeoverPending,
    })
  }

  private applyIdentityEffect(
    session: TerminalSessionView<TUser>,
    effect: { resizeTo?: { cols: number; rows: number }; emitIdentity: boolean },
  ): void {
    if (effect.resizeTo) this.resizeSessionPty(session, effect.resizeTo.cols, effect.resizeTo.rows)
    if (effect.emitIdentity) this.emitIdentity(session)
  }

  private resetSessionState(
    session: TerminalSessionView<TUser>,
    cols: number,
    rows: number,
    phase: 'opening' | 'restarting' = 'opening',
  ): void {
    session.ptyBinding.reset(session, cols, rows, phase)
  }

  private async spawnAndAttachSession(session: TerminalSessionView<TUser>): Promise<TerminalPtyAttachResult> {
    const spawn = await session.ptyBinding.spawn(session)
    if (!spawn.result.ok) return { generation: spawn.generation, result: spawn.result }
    const attach = await this.attachResult(session)
    if (!session.ptyBinding.isCurrentSpawn(session, spawn.generation)) {
      return { generation: spawn.generation, result: { ok: false, message: 'error.unavailable' } }
    }
    return { generation: spawn.generation, result: attach }
  }

  private createPtyBinding(): TerminalPtyBinding<TerminalSessionView<TUser>> {
    return new TerminalPtyBinding<TerminalSessionView<TUser>>(this.ptySupervisor, {
      isSessionLive: (session) => this.isLiveSession(session),
      emitLifecycle: (session) => this.emitLifecycle(session),
      emitOutput: (session, event) => this.sink.onOutput(session.userId, event),
      emitTitle: (session, event) => this.sink.onTitle?.(session.userId, event),
      emitExit: (session, event) => this.sink.onExit(session.userId, event),
      closeSession: (ptySessionId) => this.closeSession(ptySessionId),
    })
  }

  private isLiveSession(session: TerminalSessionView<TUser>): boolean {
    return this.sessionsByPtySessionId.get(session.id) === session
  }

  private getSession(userId: TUser, ptySessionId: string): TerminalSessionView<TUser> | undefined {
    if (!this.isValidUserId(userId) || !isValidTerminalPtySessionId(ptySessionId)) return undefined
    const session = this.sessionsByPtySessionId.get(ptySessionId)
    return session?.userId === userId ? session : undefined
  }

  private isValidUserId(userId: TUser): boolean {
    return (
      (typeof userId === 'number' && Number.isSafeInteger(userId) && userId > 0) ||
      (typeof userId === 'string' && userId.length > 0)
    )
  }
}

export function isValidTerminalWriteData(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_TERMINAL_WRITE_CHARS && !value.includes('\0')
}

// Map the shared authority-rejection reasons to user-visible error
// keys. Lives next to the manager because the keys are the wire
// protocol's; the decision function itself stays string-free so it
// can be reused for non-IPC paths (e.g. internal supervisor logic).
function authorityReasonToMessage(reason: 'not-controller' | 'session-unowned' | 'unknown-client'): string {
  switch (reason) {
    case 'not-controller':
      return 'error.not-controller'
    case 'session-unowned':
      // Unowned sessions must be explicitly taken over before they
      // can be restarted. The same error key is appropriate because
      // takeover is required before recovery, even if there is
      // currently no effective controller.
      return 'error.not-controller'
    case 'unknown-client':
      return 'error.invalid-arguments'
  }
}

function createPtySessionId(): string {
  return `pty_${crypto.randomUUID()}`
}

function parseWorktreePathFromTerminalKey(terminalKey: string): string | null {
  return parseTerminalWorkspaceSlotKey(terminalKey)?.worktreePath ?? null
}
