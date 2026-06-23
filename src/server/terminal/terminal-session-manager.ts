import crypto from 'node:crypto'
import path from 'node:path'
import {
  type TerminalAttachResult,
  type TerminalController,
  type TerminalExitEvent,
  type TerminalOwnershipEvent,
  type TerminalOutputEvent,
  type TerminalSlotPhase,
  type TerminalSlotSnapshot,
  type TerminalSlotSummary,
  type TerminalTakeoverResult,
} from '#/shared/terminal-types.ts'
import { cloneTerminalController } from '#/shared/terminal-ownership.ts'
import { isValidTerminalPtySessionId, normalizeTerminalSize } from '#/shared/terminal-validators.ts'
import { parseTerminalSlotKey } from '#/shared/terminal-slot-key.ts'
import { serverLogger } from '#/server/logger.ts'
import type { TerminalViewOrderRuntime } from '#/server/terminal/terminal-view-order-runtime.ts'
import {
  attachTerminalClient,
  claimTerminalClientControl,
  explainAuthority,
  isAuthoritative,
  registerTerminalClient,
  restartTerminalClientControl,
  type TerminalClientState,
  updateTerminalClientConnection,
} from '#/server/terminal/terminal-ownership.ts'
import {
  appendOutput,
  createEmptyTerminalRenderState,
  disposeRender,
  isShellProcessName,
  replaySnapshot,
  resetRender,
  resizeRender,
  takeSnapshot,
  type TerminalRenderState,
} from '#/server/terminal/terminal-render-state.ts'
import {
  markTerminalSessionClosed,
  markTerminalSessionError,
  markTerminalSessionOpen,
  markTerminalSessionOpening,
  markTerminalSessionRestarting,
} from '#/server/terminal/terminal-session-lifecycle.ts'
import type { PtyHandle, PtySupervisor } from '#/server/terminal/pty-supervisor.ts'

const MAX_TERMINAL_WRITE_CHARS = 1024 * 1024
const sessionManagerLogger = serverLogger.child({ module: 'terminal-session-manager' })

type TerminalViewOrderRuntimeLike<TUser extends string | number> = Pick<
  TerminalViewOrderRuntime<TUser>,
  'registerTerminalView' | 'unregisterTerminalView' | 'viewDisplayOrder'
>

export interface TerminalEnsureSessionInput<TUser extends string | number> {
  userId: TUser
  scope: string
  key: string
  cwd: string
  cols: number
  rows: number
  clientId?: string
  clientConnected?: boolean
  forceNew?: boolean
  command?: string
  args?: string[]
  env?: Record<string, string>
}

interface TerminalSlot<TUser extends string | number> {
  id: string
  userId: TUser
  scope: string
  key: string
  worktreePath: string
  cwd: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  cols: number
  rows: number
  pty: PtyHandle | null
  disposables: Array<{ dispose(): void }>
  render: TerminalRenderState
  attachments: Map<string, TerminalClientState>
  controller: TerminalController | null
  /**
   * Sticky owner-level claim. Once any attachment from this session's
   * owner has successfully attached or taken over, this stays set
   * for the lifetime of the session so a subsequent attach from a
   * different clientId (e.g. switching devices) can still
   * auto-claim when no controller is alive.
   */
  ownerSticky: boolean
  phase: TerminalSlotPhase
  message: string | null
  /** Input queue ensures ordered PTY writes even with multiple concurrent callers. */
  inputQueue: string[]
  /** True when a microtask flush has already been scheduled for this session. */
  inputFlushScheduled: boolean
}

export interface TerminalEventSink<TUser extends string | number> {
  onOutput(userId: TUser, event: TerminalOutputEvent): void
  onTitle?(userId: TUser, event: { ptySessionId: string; canonicalTitle: string | null }): void
  onExit(userId: TUser, event: TerminalExitEvent): void
  onOwnership?(userId: TUser, event: TerminalOwnershipEvent): void
}

export class TerminalSlotManager<TUser extends string | number> {
  private readonly slotsByPtySessionId = new Map<string, TerminalSlot<TUser>>()
  private readonly ptySessionIdByUserSlotKey = new Map<string, string>()
  private readonly sink: TerminalEventSink<TUser>
  private readonly ptySupervisor: PtySupervisor
  private readonly terminalViewOrder: TerminalViewOrderRuntimeLike<TUser>

  constructor(
    ptySupervisor: PtySupervisor,
    sink: TerminalEventSink<TUser>,
    terminalViewOrder: TerminalViewOrderRuntimeLike<TUser>,
  ) {
    this.ptySupervisor = ptySupervisor
    this.sink = sink
    this.terminalViewOrder = terminalViewOrder
  }

  async ensureSlot(input: TerminalEnsureSessionInput<TUser>): Promise<TerminalAttachResult> {
    const size = normalizeTerminalSize(input.cols, input.rows)
    if (!size) return { ok: false, message: 'error.invalid-arguments' }

    const cwd = path.resolve(input.cwd)
    const userId = input.userId
    if (!this.isValidUserId(userId)) return { ok: false, message: 'error.invalid-arguments' }
    const ownerKey = this.userSlotKey(userId, input.key)
    if (input.forceNew) this.closeOwnerKey(userId, input.key)
    const existingId = this.ptySessionIdByUserSlotKey.get(ownerKey)
    const existing = existingId ? this.slotsByPtySessionId.get(existingId) : undefined
    if (existing) {
      this.terminalViewOrder.registerTerminalView({
        userId,
        scope: existing.scope,
        worktreePath: existing.worktreePath,
        id: existing.key,
      })
      if (input.clientId) {
        registerTerminalClient(existing, input.clientId, size.cols, size.rows, input.clientConnected)
        this.applyOwnershipEffect(existing, attachTerminalClient(existing, input.clientId))
      }
      return await this.attachResult(existing)
    }

    const worktreePath = parseWorktreePathFromKey(input.key) ?? input.key
    const id = createPtySessionId()
    const session: TerminalSlot<TUser> = {
      id,
      userId,
      scope: input.scope,
      key: input.key,
      worktreePath,
      cwd,
      command: input.command,
      args: input.args,
      env: input.env,
      cols: size.cols,
      rows: size.rows,
      pty: null,
      disposables: [],
      render: createEmptyTerminalRenderState(size.cols, size.rows),
      attachments: new Map(),
      controller: null,
      ownerSticky: false,
      phase: 'opening',
      message: null,
      inputQueue: [],
      inputFlushScheduled: false,
    }
    this.slotsByPtySessionId.set(id, session)
    this.ptySessionIdByUserSlotKey.set(ownerKey, id)
    this.terminalViewOrder.registerTerminalView({
      userId,
      scope: input.scope,
      worktreePath,
      id: input.key,
    })
    if (input.clientId) {
      registerTerminalClient(session, input.clientId, size.cols, size.rows, input.clientConnected ?? true)
      attachTerminalClient(session, input.clientId)
    }
    const result = await this.spawnSessionPty(session)
    if (!result.ok) {
      // Spawn failed: do not leave a zombie session in the maps. The
      // catalog would otherwise find it on retry and surface it as a
      // successful attach with an empty buffer and a null pty — i.e.
      // a blank, non-responsive terminal. `closeSlot` removes the
      // map entry and frees pty/listener resources via the standard
      // disposal path.
      this.closeSlot(id)
      return result
    }
    return result
  }

  writeSlot(userId: TUser, ptySessionId: string, data: string, clientId: string): boolean {
    if (!isValidTerminalPtySessionId(ptySessionId) || !isValidTerminalWriteData(data)) return false
    const session = this.getSlot(userId, ptySessionId)
    if (!session?.pty) return false
    // Register the attachment first so a brand-new socket can satisfy
    // the unknown-attachment gate, then defer to the shared
    // authority helper so write/resize/restart stay in lockstep.
    registerTerminalClient(session, clientId, session.cols, session.rows, undefined)
    if (!isAuthoritative(session, clientId, 'write')) return false
    session.inputQueue.push(data)
    this.scheduleInputFlush(session)
    return true
  }

  async attachSession(
    userId: TUser,
    ptySessionId: string,
    cols: number,
    rows: number,
    clientId: string,
    clientConnected?: boolean,
  ): Promise<TerminalAttachResult> {
    if (!isValidTerminalPtySessionId(ptySessionId)) return { ok: false, message: 'error.invalid-arguments' }
    const size = normalizeTerminalSize(cols, rows)
    if (!size) return { ok: false, message: 'error.invalid-arguments' }
    const session = this.getSlot(userId, ptySessionId)
    if (!session) return { ok: false, message: 'error.invalid-arguments' }
    registerTerminalClient(session, clientId, size.cols, size.rows, clientConnected)
    this.applyOwnershipEffect(session, attachTerminalClient(session, clientId))
    return await this.attachResult(session)
  }

  resizeSlot(
    userId: TUser,
    ptySessionId: string,
    cols: number,
    rows: number,
    clientId: string,
    clientConnected?: boolean,
  ): boolean {
    if (!isValidTerminalPtySessionId(ptySessionId)) return false
    const size = normalizeTerminalSize(cols, rows)
    if (!size) return false
    const session = this.getSlot(userId, ptySessionId)
    if (!session) return false
    registerTerminalClient(session, clientId, size.cols, size.rows, clientConnected)
    if (!isAuthoritative(session, clientId, 'resize')) return false
    return this.resizeSessionPty(session, size.cols, size.rows)
  }

  takeoverSlot(
    userId: TUser,
    ptySessionId: string,
    cols: number,
    rows: number,
    clientId: string,
    clientConnected?: boolean,
  ): TerminalTakeoverResult {
    if (!isValidTerminalPtySessionId(ptySessionId)) return { ok: false, message: 'error.invalid-arguments' }
    const size = normalizeTerminalSize(cols, rows)
    if (!size) return { ok: false, message: 'error.invalid-arguments' }
    const session = this.getSlot(userId, ptySessionId)
    if (!session) return { ok: false, message: 'error.invalid-arguments' }
    // Takeover is the only path that may preempt, but it still
    // requires the caller to be a known attachment. Use the same
    // authority gate as the other actions for consistency.
    registerTerminalClient(session, clientId, size.cols, size.rows, clientConnected)
    if (!isAuthoritative(session, clientId, 'takeover')) {
      return { ok: false, message: 'error.invalid-arguments' }
    }
    const effect = claimTerminalClientControl(session, clientId)
    this.applyOwnershipEffect(session, effect)
    // Bug D: when the attachment isn't `connected`, the effect
    // is empty (no resize, no ownership event) — the caller is
    // known but not authoritative yet (the WS hasn't been
    // observed as alive for this attachment). Surfacing `ok:
    // true` here would tell the renderer it became controller
    // when nothing actually changed; the existing
    // `takeoverResult()` would still hardcode
    // `role: 'controller'` and `controllerStatus: 'connected'`,
    // masking the no-op. Reject with the same key the renderer
    // maps to "session lost" so the user can retry.
    if (!effect.emitOwnership && !effect.resizeTo) {
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
    clientConnected?: boolean,
  ): Promise<TerminalAttachResult> {
    if (!isValidTerminalPtySessionId(ptySessionId)) return { ok: false, message: 'error.invalid-arguments' }
    const size = normalizeTerminalSize(cols, rows)
    if (!size) return { ok: false, message: 'error.invalid-arguments' }
    const session = this.getSlot(userId, ptySessionId)
    if (!session) return { ok: false, message: 'error.invalid-arguments' }
    registerTerminalClient(session, clientId, size.cols, size.rows, clientConnected)
    const denyReason = explainAuthority(session, clientId, 'restart')
    if (denyReason !== null) {
      return { ok: false, message: authorityReasonToMessage(denyReason) }
    }
    restartTerminalClientControl(session, clientId)
    this.resetSessionState(session, size.cols, size.rows, 'restarting')
    const result = await this.spawnSessionPty(session)
    if (!result.ok) {
      markTerminalSessionError(session, result.message)
    }
    return result
  }

  closeSlotForUser(userId: TUser, ptySessionId: string): boolean {
    if (!this.getSlot(userId, ptySessionId)) return false
    this.closeSlot(ptySessionId)
    return true
  }

  closeSlot(ptySessionId: string): void {
    const session = this.slotsByPtySessionId.get(ptySessionId)
    if (!session) return
    markTerminalSessionClosed(session)
    this.slotsByPtySessionId.delete(ptySessionId)
    const ownerKey = this.userSlotKey(session.userId, session.key)
    if (this.ptySessionIdByUserSlotKey.get(ownerKey) === ptySessionId) this.ptySessionIdByUserSlotKey.delete(ownerKey)
    this.terminalViewOrder.unregisterTerminalView({
      userId: session.userId,
      scope: session.scope,
      worktreePath: session.worktreePath,
      id: session.key,
    })
    this.disposeSessionResources(session)
  }

  closeSessionsForOwner(userId: TUser): void {
    for (const session of Array.from(this.slotsByPtySessionId.values())) {
      if (session.userId === userId) this.closeSlot(session.id)
    }
  }

  setAttachmentConnected(userId: TUser, clientId: string, connected: boolean): void {
    for (const session of Array.from(this.slotsByPtySessionId.values())) {
      if (session.userId !== userId) continue
      this.applyOwnershipEffect(session, updateTerminalClientConnection(session, clientId, connected))
    }
  }

  closeAll(): void {
    for (const ptySessionId of Array.from(this.slotsByPtySessionId.keys())) this.closeSlot(ptySessionId)
  }

  async getSlotSnapshot(userId: TUser, ptySessionId: string): Promise<TerminalSlotSnapshot | null> {
    const session = this.getSlot(userId, ptySessionId)
    if (!session) return null
    const snap = await takeSnapshot(session.render)
    if (!snap) return null
    return { ptySessionId, snapshot: snap.snapshot, snapshotSeq: snap.snapshotSeq }
  }

  async listSlotsForUser(userId: TUser, scope: string): Promise<TerminalSlotSummary[]> {
    const sessions: TerminalSlotSummary[] = []
    for (const session of Array.from(this.slotsByPtySessionId.values())) {
      if (session.userId === userId && session.scope === scope) {
        sessions.push({
          ptySessionId: session.id,
          key: session.key,
          viewType: 'terminal',
          viewId: session.key,
          cwd: session.cwd,
          controller: cloneTerminalController(session.controller),
          processName: session.pty ? this.ptySupervisor.processName(session.pty) : 'terminal',
          canonicalTitle: session.render.title,
          phase: session.phase,
          message: session.message,
          cols: session.cols,
          rows: session.rows,
          displayOrder: this.terminalViewDisplayOrder(session),
        })
      }
    }
    sessions.sort((a, b) => a.displayOrder - b.displayOrder)
    return sessions
  }

  // Look up a session by id and verify it belongs to the given
  // owner. Public so the runtime can resolve the scope for
  // `sessions-changed` broadcasts without exposing the rest of the
  // session internals.
  getSlot(userId: TUser, ptySessionId: string): TerminalSlot<TUser> | undefined {
    if (!this.isValidUserId(userId) || !isValidTerminalPtySessionId(ptySessionId)) return undefined
    const session = this.slotsByPtySessionId.get(ptySessionId)
    return session?.userId === userId ? session : undefined
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
    for (const session of this.slotsByPtySessionId.values()) {
      count += 1
      const chars = session.render.buffer.length
      totalBufferChars += chars
      if (chars > maxBufferChars) maxBufferChars = chars
    }
    return { count, totalBufferChars, maxBufferChars }
  }

  private closeOwnerKey(userId: TUser, key: string): void {
    const id = this.ptySessionIdByUserSlotKey.get(this.userSlotKey(userId, key))
    if (id) this.closeSlot(id)
  }

  private terminalViewDisplayOrder(session: TerminalSlot<TUser>): number {
    return (
      this.terminalViewOrder.viewDisplayOrder({
        userId: session.userId,
        scope: session.scope,
        worktreePath: session.worktreePath,
        id: session.key,
      }) ?? Number.MAX_SAFE_INTEGER
    )
  }

  // Sends SIGWINCH to the child PTY and queues the same geometry change
  // into the server-side headless xterm state. The shell's repaint still
  // arrives through the regular `onData` path, but snapshots taken during
  // the transition are serialized from a screen model with the canonical
  // dimensions instead of replaying raw historical bytes into the client.
  private resizeSessionPty(session: TerminalSlot<TUser>, cols: number, rows: number): boolean {
    if (!session.pty) return false
    if (session.cols === cols && session.rows === rows) return true
    try {
      this.ptySupervisor.resize(session.pty, cols, rows)
      resizeRender(session.render, cols, rows)
      session.cols = cols
      session.rows = rows
      this.emitOwnership(session)
      return true
    } catch (err) {
      sessionManagerLogger.warn({ ptySessionId: session.id, err }, 'failed to resize PTY')
      return false
    }
  }

  private takeoverResult(session: TerminalSlot<TUser>): TerminalTakeoverResult {
    // By the time we get here, `applyOwnershipEffect` has already
    // executed in `takeoverSlot()` — the requesting attachment
    // is the controller and `session.cols`/`session.rows` reflect
    // any resize effect that ran during the ownership claim. We
    // surface all four frame fields synchronously so the renderer
    // doesn't have to wait for a follow-up realtime `ownership`
    // event before painting the post-takeover frame. See
    // `docs/terminal-session-lifecycle.md` §Takeover atomicity.
    return {
      ok: true,
      ptySessionId: session.id,
      role: 'controller',
      controllerStatus: 'connected',
      controller: cloneTerminalController(session.controller),
      canonicalCols: session.cols,
      canonicalRows: session.rows,
      phase: session.phase,
    }
  }

  private async attachResult(session: TerminalSlot<TUser>): Promise<TerminalAttachResult> {
    const snap = await replaySnapshot(session.render)
    if (!snap) return { ok: false, message: 'error.unavailable' }
    return {
      ok: true,
      ptySessionId: session.id,
      snapshot: snap.snapshot,
      snapshotSeq: snap.snapshotSeq,
      processName: session.pty ? this.ptySupervisor.processName(session.pty) : 'terminal',
      canonicalTitle: session.render.title,
      phase: session.phase,
      message: session.message,
      controller: cloneTerminalController(session.controller),
      canonicalCols: session.cols,
      canonicalRows: session.rows,
    }
  }

  private userSlotKey(userId: TUser, key: string): string {
    return `${String(userId)}\0${key}`
  }

  private emitOwnership(session: TerminalSlot<TUser>): void {
    this.sink.onOwnership?.(session.userId, {
      ptySessionId: session.id,
      controller: cloneTerminalController(session.controller),
      cols: session.cols,
      rows: session.rows,
      phase: session.phase,
    })
  }

  private applyOwnershipEffect(
    session: TerminalSlot<TUser>,
    effect: { resizeTo?: { cols: number; rows: number }; emitOwnership: boolean },
  ): void {
    if (effect.resizeTo) this.resizeSessionPty(session, effect.resizeTo.cols, effect.resizeTo.rows)
    if (effect.emitOwnership) this.emitOwnership(session)
  }

  private resetSessionState(
    session: TerminalSlot<TUser>,
    cols: number,
    rows: number,
    phase: TerminalSlotPhase = 'opening',
  ): void {
    this.disposeSessionResources(session)
    session.cols = cols
    session.rows = rows
    if (phase === 'restarting') markTerminalSessionRestarting(session)
    else markTerminalSessionOpening(session)
    resetRender(session.render, cols, rows)
    session.inputQueue = []
    session.inputFlushScheduled = false
  }

  private async spawnSessionPty(session: TerminalSlot<TUser>): Promise<TerminalAttachResult> {
    // We do NOT call `disposeSessionResources` on the failure path
    // here. The caller decides what to do with a failed spawn:
    //   - `ensureSlot` removes the just-created session from the
    //     maps so the catalog doesn't surface a zombie on retry.
    //   - `restartSession` keeps the session in the maps (the new
    //     pty simply wasn't created) so a later retry can succeed.
    // In both cases the failed spawn itself does not need any
    // listener/pty cleanup — the spawn attempt never wired them.
    let resolved: { ok: true; handle: PtyHandle; processName: string } | { ok: false; message: string }
    try {
      resolved = await this.ptySupervisor.spawn({
        command: session.command,
        args: session.args,
        cwd: session.cwd,
        cols: session.cols,
        rows: session.rows,
        env: session.env,
      })
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'error.unknown' }
    }
    if (!resolved.ok) {
      return resolved
    }
    session.pty = resolved.handle
    markTerminalSessionOpen(session)
    const handle = resolved.handle
    const supervisor = this.ptySupervisor
    let lastBroadcastTitle: string | null = session.render.title
    let lastProcessName: string = supervisor.processName(handle)
    session.disposables.push(
      supervisor.onData(handle, (data) => {
        const titleBeforeData = session.render.title
        const processNameBeforeData = lastProcessName

        const seq = appendOutput(session.render, data)

        const processNameAfterData = supervisor.processName(handle)
        lastProcessName = processNameAfterData

        // Stale title detection: when a child process exits without
        // setting a new title-OSC, the tab would keep showing the
        // child's title (e.g. "Claude Code 2.1.174"). Detect the
        // non-shell → shell process name transition with no new
        // title in the chunk and clear the stale title.
        if (
          titleBeforeData !== null &&
          session.render.title === titleBeforeData &&
          !isShellProcessName(processNameBeforeData) &&
          isShellProcessName(processNameAfterData)
        ) {
          session.render.title = null
          if (lastBroadcastTitle !== null) {
            lastBroadcastTitle = null
            this.sink.onTitle?.(session.userId, {
              ptySessionId: session.id,
              canonicalTitle: null,
            })
          }
        }

        if (session.render.title !== lastBroadcastTitle) {
          lastBroadcastTitle = session.render.title
          this.sink.onTitle?.(session.userId, {
            ptySessionId: session.id,
            canonicalTitle: session.render.title,
          })
        }
        this.sink.onOutput(session.userId, {
          ptySessionId: session.id,
          data,
          seq,
          processName: processNameAfterData,
        })
      }),
    )
    session.disposables.push(
      this.ptySupervisor.onExit(handle, () => {
        session.pty = null
        this.sink.onExit(session.userId, { ptySessionId: session.id })
        this.closeSlot(session.id)
      }),
    )
    return await this.attachResult(session)
  }

  private disposeSessionResources(session: TerminalSlot<TUser>): void {
    disposeSessionListeners(session)
    disposeRender(session.render)
    if (session.pty) {
      try {
        this.ptySupervisor.kill(session.pty)
      } catch (err) {
        sessionManagerLogger.warn({ ptySessionId: session.id, err }, 'failed to kill PTY')
      }
    }
    session.pty = null
    session.inputQueue = []
    session.inputFlushScheduled = false
  }

  private scheduleInputFlush(session: TerminalSlot<TUser>): void {
    if (session.inputFlushScheduled || session.inputQueue.length === 0 || !session.pty) return
    session.inputFlushScheduled = true
    queueMicrotask(() => {
      session.inputFlushScheduled = false
      this.drainInputQueue(session)
    })
  }

  private drainInputQueue(session: TerminalSlot<TUser>): void {
    if (session.inputQueue.length === 0 || !session.pty) return
    const batch = session.inputQueue.splice(0).join('')
    try {
      this.ptySupervisor.write(session.pty, batch)
    } catch (err) {
      sessionManagerLogger.warn({ ptySessionId: session.id, err, bytes: batch.length }, 'failed to write PTY')
    }
  }

  private isValidUserId(userId: TUser): boolean {
    return (
      (typeof userId === 'number' && Number.isSafeInteger(userId) && userId > 0) ||
      (typeof userId === 'string' && userId.length > 0)
    )
  }
}

export function isValidTerminalWriteData(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_TERMINAL_WRITE_CHARS
}

// Map the shared authority-rejection reasons to user-visible error
// keys. Lives next to the manager because the keys are the wire
// protocol's; the decision function itself stays string-free so it
// can be reused for non-IPC paths (e.g. internal supervisor logic).
function authorityReasonToMessage(reason: 'not-controller' | 'session-unowned' | 'unknown-attachment'): string {
  switch (reason) {
    case 'not-controller':
      return 'error.not-controller'
    case 'session-unowned':
      // Unowned sessions must be explicitly taken over before they
      // can be restarted. The same error key is appropriate: a
      // different session already "owns" the recovery, even if the
      // controller slot is currently empty.
      return 'error.not-controller'
    case 'unknown-attachment':
      return 'error.invalid-arguments'
  }
}

function disposeSessionListeners<TUser extends string | number>(session: TerminalSlot<TUser>): void {
  for (const disposable of session.disposables.splice(0)) {
    try {
      disposable.dispose()
    } catch (err) {
      sessionManagerLogger.warn({ ptySessionId: session.id, err }, 'failed to dispose PTY listener')
    }
  }
}

function createPtySessionId(): string {
  return `term_${crypto.randomUUID()}`
}

function parseWorktreePathFromKey(key: string): string | null {
  return parseTerminalSlotKey(key)?.worktreePath ?? null
}
