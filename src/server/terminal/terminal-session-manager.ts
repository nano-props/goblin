import crypto from 'node:crypto'
import path from 'node:path'
import {
  type TerminalAttachResult,
  type TerminalController,
  type TerminalExitEvent,
  type TerminalOwnershipEvent,
  type TerminalOutputEvent,
  type TerminalSessionPhase,
  type TerminalSessionSnapshot,
  type TerminalSessionSummary,
  type TerminalTakeoverResult,
} from '#/shared/terminal-types.ts'
import { cloneTerminalController } from '#/shared/terminal-ownership.ts'
import { isValidTerminalSessionId, normalizeTerminalSize } from '#/shared/terminal-validators.ts'
import { parseTerminalSessionKey } from '#/shared/terminal-session-key.ts'
import { serverLogger } from '#/server/logger.ts'
import type { WorkspacePaneRuntime } from '#/server/workspace-pane/workspace-pane-runtime.ts'
import {
  attachTerminalAttachment,
  claimTerminalAttachmentControl,
  explainAuthority,
  expireTerminalAttachment,
  isAuthoritative,
  registerTerminalAttachment,
  restartTerminalAttachmentControl,
  type TerminalAttachmentState,
  updateTerminalAttachmentConnection,
} from '#/server/terminal/terminal-ownership.ts'
import {
  appendOutput,
  createEmptyTerminalRenderState,
  isShellProcessName,
  replaySnapshot,
  resetRender,
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

type TerminalWorkspacePaneRuntime<TOwner extends string | number> = Pick<
  WorkspacePaneRuntime<TOwner>,
  'registerTerminalView' | 'unregisterTerminalView' | 'viewDisplayOrder'
>

export interface TerminalEnsureSessionInput<TOwner extends string | number> {
  ownerId: TOwner
  scope: string
  key: string
  cwd: string
  cols: number
  rows: number
  attachmentId?: string
  attachmentConnected?: boolean
  forceNew?: boolean
  command?: string
  args?: string[]
  env?: Record<string, string>
}

interface TerminalSession<TOwner extends string | number> {
  id: string
  ownerId: TOwner
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
  attachments: Map<string, TerminalAttachmentState>
  controller: TerminalController | null
  allowImplicitAttachControl: boolean
  phase: TerminalSessionPhase
  message: string | null
  /** Input queue ensures ordered PTY writes even with multiple concurrent callers. */
  inputQueue: string[]
  /** True when a microtask flush has already been scheduled for this session. */
  inputFlushScheduled: boolean
}

export interface TerminalEventSink<TOwner extends string | number> {
  onOutput(ownerId: TOwner, event: TerminalOutputEvent): void
  onTitle?(ownerId: TOwner, event: { sessionId: string; canonicalTitle: string | null }): void
  onExit(ownerId: TOwner, event: TerminalExitEvent): void
  onOwnership?(ownerId: TOwner, event: TerminalOwnershipEvent): void
}

export class TerminalSessionManager<TOwner extends string | number> {
  private readonly sessionsById = new Map<string, TerminalSession<TOwner>>()
  private readonly sessionIdByOwnerKey = new Map<string, string>()
  private readonly sink: TerminalEventSink<TOwner>
  private readonly ptySupervisor: PtySupervisor
  private readonly workspacePane: TerminalWorkspacePaneRuntime<TOwner>

  constructor(
    ptySupervisor: PtySupervisor,
    sink: TerminalEventSink<TOwner>,
    workspacePane: TerminalWorkspacePaneRuntime<TOwner>,
  ) {
    this.ptySupervisor = ptySupervisor
    this.sink = sink
    this.workspacePane = workspacePane
  }

  async ensureSession(input: TerminalEnsureSessionInput<TOwner>): Promise<TerminalAttachResult> {
    const size = normalizeTerminalSize(input.cols, input.rows)
    if (!size) return { ok: false, message: 'error.invalid-arguments' }

    const cwd = path.resolve(input.cwd)
    const ownerId = input.ownerId
    if (!this.isValidOwnerId(ownerId)) return { ok: false, message: 'error.invalid-arguments' }
    const ownerKey = this.sessionOwnerKey(ownerId, input.key)
    if (input.forceNew) this.closeOwnerKey(ownerId, input.key)
    const existingId = this.sessionIdByOwnerKey.get(ownerKey)
    const existing = existingId ? this.sessionsById.get(existingId) : undefined
    if (existing) {
      this.workspacePane.registerTerminalView({
        ownerId,
        scope: existing.scope,
        worktreePath: existing.worktreePath,
        id: existing.key,
      })
      if (input.attachmentId) {
        registerTerminalAttachment(existing, input.attachmentId, size.cols, size.rows, input.attachmentConnected)
      }
      return this.attachResult(existing)
    }

    const worktreePath = parseWorktreePathFromKey(input.key) ?? input.key
    const id = createSessionId()
    const session: TerminalSession<TOwner> = {
      id,
      ownerId,
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
      render: createEmptyTerminalRenderState(),
      attachments: new Map(),
      controller: null,
      allowImplicitAttachControl: true,
      phase: 'opening',
      message: null,
      inputQueue: [],
      inputFlushScheduled: false,
    }
    this.sessionsById.set(id, session)
    this.sessionIdByOwnerKey.set(ownerKey, id)
    this.workspacePane.registerTerminalView({
      ownerId,
      scope: input.scope,
      worktreePath,
      id: input.key,
    })
    if (input.attachmentId) {
      registerTerminalAttachment(session, input.attachmentId, size.cols, size.rows, input.attachmentConnected ?? true)
      session.controller = session.attachments.get(input.attachmentId)?.connected
        ? { attachmentId: input.attachmentId, status: 'connected' }
        : null
    }
    const result = await this.spawnSessionPty(session)
    if (!result.ok) {
      // Spawn failed: do not leave a zombie session in the maps. The
      // catalog would otherwise find it on retry and surface it as a
      // successful attach with an empty buffer and a null pty — i.e.
      // a blank, non-responsive terminal. `closeSession` removes the
      // map entry and frees pty/listener resources via the standard
      // disposal path.
      this.closeSession(id)
      return result
    }
    return result
  }

  writeSession(ownerId: TOwner, sessionId: string, data: string, attachmentId?: string): boolean {
    if (!isValidTerminalSessionId(sessionId) || !isValidTerminalWriteData(data)) return false
    const session = this.getSession(ownerId, sessionId)
    if (!session?.pty) return false
    if (attachmentId) {
      // Register the attachment first so a brand-new socket can satisfy
      // the unknown-attachment gate, then defer to the shared
      // authority helper so write/resize/restart stay in lockstep.
      registerTerminalAttachment(session, attachmentId, session.cols, session.rows, undefined)
      if (!isAuthoritative(session, attachmentId, 'write')) return false
    } else if (session.controller !== null) {
      // A controller exists but the caller did not identify itself.
      return false
    }
    session.inputQueue.push(data)
    this.scheduleInputFlush(session)
    return true
  }

  attachSession(
    ownerId: TOwner,
    sessionId: string,
    cols: number,
    rows: number,
    attachmentId?: string,
    attachmentConnected?: boolean,
  ): TerminalAttachResult {
    if (!isValidTerminalSessionId(sessionId)) return { ok: false, message: 'error.invalid-arguments' }
    const size = normalizeTerminalSize(cols, rows)
    if (!size) return { ok: false, message: 'error.invalid-arguments' }
    const session = this.getSession(ownerId, sessionId)
    if (!session) return { ok: false, message: 'error.invalid-arguments' }
    if (attachmentId) {
      registerTerminalAttachment(session, attachmentId, size.cols, size.rows, attachmentConnected)
      this.applyOwnershipEffect(session, attachTerminalAttachment(session, attachmentId))
    }
    return this.attachResult(session)
  }

  resizeSession(
    ownerId: TOwner,
    sessionId: string,
    cols: number,
    rows: number,
    attachmentId?: string,
    attachmentConnected?: boolean,
  ): boolean {
    if (!isValidTerminalSessionId(sessionId)) return false
    const size = normalizeTerminalSize(cols, rows)
    if (!size) return false
    const session = this.getSession(ownerId, sessionId)
    if (!session) return false
    if (!attachmentId) return false
    registerTerminalAttachment(session, attachmentId, size.cols, size.rows, attachmentConnected)
    if (!isAuthoritative(session, attachmentId, 'resize')) return false
    return this.resizeSessionPty(session, size.cols, size.rows)
  }

  takeoverSession(
    ownerId: TOwner,
    sessionId: string,
    cols: number,
    rows: number,
    attachmentId?: string,
    attachmentConnected?: boolean,
  ): TerminalTakeoverResult {
    if (!isValidTerminalSessionId(sessionId)) return { ok: false, message: 'error.invalid-arguments' }
    const size = normalizeTerminalSize(cols, rows)
    if (!size) return { ok: false, message: 'error.invalid-arguments' }
    const session = this.getSession(ownerId, sessionId)
    if (!session) return { ok: false, message: 'error.invalid-arguments' }
    if (attachmentId) {
      // Takeover is the only path that may preempt, but it still
      // requires the caller to be a known attachment. Use the same
      // authority gate as the other actions for consistency.
      registerTerminalAttachment(session, attachmentId, size.cols, size.rows, attachmentConnected)
      if (!isAuthoritative(session, attachmentId, 'takeover')) {
        return { ok: false, message: 'error.invalid-arguments' }
      }
      const effect = claimTerminalAttachmentControl(session, attachmentId)
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
    return { ok: false, message: 'error.invalid-arguments' }
  }

  async restartSession(
    ownerId: TOwner,
    sessionId: string,
    cols: number,
    rows: number,
    attachmentId?: string,
    attachmentConnected?: boolean,
  ): Promise<TerminalAttachResult> {
    if (!isValidTerminalSessionId(sessionId)) return { ok: false, message: 'error.invalid-arguments' }
    const size = normalizeTerminalSize(cols, rows)
    if (!size) return { ok: false, message: 'error.invalid-arguments' }
    const session = this.getSession(ownerId, sessionId)
    if (!session) return { ok: false, message: 'error.invalid-arguments' }
    if (attachmentId) {
      registerTerminalAttachment(session, attachmentId, size.cols, size.rows, attachmentConnected)
      const denyReason = explainAuthority(session, attachmentId, 'restart')
      if (denyReason !== null) {
        return { ok: false, message: authorityReasonToMessage(denyReason) }
      }
      restartTerminalAttachmentControl(session, attachmentId)
    } else if (session.controller !== null) {
      // A controller exists but the caller did not identify itself.
      return { ok: false, message: 'error.invalid-arguments' }
    }
    this.resetSessionState(session, size.cols, size.rows, 'restarting')
    const result = await this.spawnSessionPty(session)
    if (!result.ok) {
      markTerminalSessionError(session, result.message)
    }
    return result
  }

  closeSessionForOwner(ownerId: TOwner, sessionId: string): boolean {
    if (!this.getSession(ownerId, sessionId)) return false
    this.closeSession(sessionId)
    return true
  }

  closeSession(sessionId: string): void {
    const session = this.sessionsById.get(sessionId)
    if (!session) return
    markTerminalSessionClosed(session)
    this.sessionsById.delete(sessionId)
    const ownerKey = this.sessionOwnerKey(session.ownerId, session.key)
    if (this.sessionIdByOwnerKey.get(ownerKey) === sessionId) this.sessionIdByOwnerKey.delete(ownerKey)
    this.workspacePane.unregisterTerminalView({
      ownerId: session.ownerId,
      scope: session.scope,
      worktreePath: session.worktreePath,
      id: session.key,
    })
    this.disposeSessionResources(session)
  }

  closeSessionsForOwner(ownerId: TOwner): void {
    for (const session of Array.from(this.sessionsById.values())) {
      if (session.ownerId === ownerId) this.closeSession(session.id)
    }
  }

  setAttachmentConnected(ownerId: TOwner, attachmentId: string, connected: boolean): void {
    for (const session of Array.from(this.sessionsById.values())) {
      if (session.ownerId !== ownerId) continue
      this.applyOwnershipEffect(session, updateTerminalAttachmentConnection(session, attachmentId, connected))
    }
  }

  expireAttachment(ownerId: TOwner, attachmentId: string): void {
    for (const session of Array.from(this.sessionsById.values())) {
      if (session.ownerId !== ownerId) continue
      const effect = expireTerminalAttachment(session, attachmentId)
      if (!effect.removed) continue
      if (effect.emitOwnership) this.emitOwnership(session)
    }
  }

  closeAll(): void {
    for (const sessionId of Array.from(this.sessionsById.keys())) this.closeSession(sessionId)
  }

  getSessionSnapshot(ownerId: TOwner, sessionId: string): TerminalSessionSnapshot | null {
    const session = this.getSession(ownerId, sessionId)
    if (!session) return null
    const snap = takeSnapshot(session.render)
    if (!snap) return null
    return { sessionId, snapshot: snap.snapshot, snapshotSeq: snap.snapshotSeq }
  }

  async listSessionsForOwner(ownerId: TOwner, scope: string): Promise<TerminalSessionSummary[]> {
    const sessions: TerminalSessionSummary[] = []
    for (const session of Array.from(this.sessionsById.values())) {
      if (session.ownerId === ownerId && session.scope === scope) {
        sessions.push({
          sessionId: session.id,
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
  getSession(ownerId: TOwner, sessionId: string): TerminalSession<TOwner> | undefined {
    if (!this.isValidOwnerId(ownerId) || !isValidTerminalSessionId(sessionId)) return undefined
    const session = this.sessionsById.get(sessionId)
    return session?.ownerId === ownerId ? session : undefined
  }

  // T4.1: aggregate replay-buffer stats across all live sessions, for
  // exposure via `ServerTerminalHost.getDiagnostics()`. The per-session
  // buffer is the source of truth for reattach; the renderer caches
  // a copy but the server's view is the authoritative memory number.
  // The char count is a close approximation of bytes for terminal
  // output (mostly ASCII); full UTF-16 byte count would be
  // `buffer.length * 2` and is an upper bound.
  getSessionBufferStats(): { count: number; totalBufferChars: number; maxBufferChars: number } {
    let count = 0
    let totalBufferChars = 0
    let maxBufferChars = 0
    for (const session of this.sessionsById.values()) {
      count += 1
      const chars = session.render.buffer.length
      totalBufferChars += chars
      if (chars > maxBufferChars) maxBufferChars = chars
    }
    return { count, totalBufferChars, maxBufferChars }
  }

  private closeOwnerKey(ownerId: TOwner, key: string): void {
    const id = this.sessionIdByOwnerKey.get(this.sessionOwnerKey(ownerId, key))
    if (id) this.closeSession(id)
  }

  private terminalViewDisplayOrder(session: TerminalSession<TOwner>): number {
    return (
      this.workspacePane.viewDisplayOrder({
        ownerId: session.ownerId,
        scope: session.scope,
        worktreePath: session.worktreePath,
        type: 'terminal',
        id: session.key,
      }) ?? Number.MAX_SAFE_INTEGER
    )
  }

  // Sends SIGWINCH to the child PTY. The shell responds by re-painting
  // its current frame at the new dimensions, and the re-paint bytes
  // arrive through the regular `onData` path → `appendOutput` →
  // `session.render.buffer`. If a client attaches between this call
  // and the re-paint, the snapshot it receives was laid out for the
  // old size; the live `output` event carrying the re-paint corrects
  // the visible state as soon as it streams in. This is acceptable
  // because the window is short (a few hundred ms for typical shells)
  // and a single terminal state is always the result of decoding the
  // concatenated stream.
  private resizeSessionPty(session: TerminalSession<TOwner>, cols: number, rows: number): boolean {
    if (!session.pty) return false
    if (session.cols === cols && session.rows === rows) return true
    try {
      this.ptySupervisor.resize(session.pty, cols, rows)
      session.cols = cols
      session.rows = rows
      this.emitOwnership(session)
      return true
    } catch (err) {
      sessionManagerLogger.warn({ sessionId: session.id, err }, 'failed to resize PTY')
      return false
    }
  }

  private takeoverResult(session: TerminalSession<TOwner>): TerminalTakeoverResult {
    // By the time we get here, `applyOwnershipEffect` has already
    // executed in `takeoverSession()` — the requesting attachment
    // is the controller and `session.cols`/`session.rows` reflect
    // any resize effect that ran during the ownership claim. We
    // surface all four frame fields synchronously so the renderer
    // doesn't have to wait for a follow-up realtime `ownership`
    // event before painting the post-takeover frame. See
    // `docs/terminal-session-lifecycle.md` §Takeover atomicity.
    return {
      ok: true,
      sessionId: session.id,
      role: 'controller',
      controllerStatus: 'connected',
      controller: cloneTerminalController(session.controller),
      canonicalCols: session.cols,
      canonicalRows: session.rows,
      phase: session.phase,
    }
  }

  private attachResult(session: TerminalSession<TOwner>): Extract<TerminalAttachResult, { ok: true }> {
    const snap = replaySnapshot(session.render)
    return {
      ok: true,
      sessionId: session.id,
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

  private sessionOwnerKey(ownerId: TOwner, key: string): string {
    return `${String(ownerId)}\0${key}`
  }

  private emitOwnership(session: TerminalSession<TOwner>): void {
    this.sink.onOwnership?.(session.ownerId, {
      sessionId: session.id,
      controller: cloneTerminalController(session.controller),
      cols: session.cols,
      rows: session.rows,
      phase: session.phase,
    })
  }

  private applyOwnershipEffect(
    session: TerminalSession<TOwner>,
    effect: { resizeTo?: { cols: number; rows: number }; emitOwnership: boolean },
  ): void {
    if (effect.resizeTo) this.resizeSessionPty(session, effect.resizeTo.cols, effect.resizeTo.rows)
    if (effect.emitOwnership) this.emitOwnership(session)
  }

  private resetSessionState(
    session: TerminalSession<TOwner>,
    cols: number,
    rows: number,
    phase: TerminalSessionPhase = 'opening',
  ): void {
    this.disposeSessionResources(session)
    session.cols = cols
    session.rows = rows
    if (phase === 'restarting') markTerminalSessionRestarting(session)
    else markTerminalSessionOpening(session)
    resetRender(session.render)
    session.inputQueue = []
    session.inputFlushScheduled = false
  }

  private async spawnSessionPty(session: TerminalSession<TOwner>): Promise<TerminalAttachResult> {
    // We do NOT call `disposeSessionResources` on the failure path
    // here. The caller decides what to do with a failed spawn:
    //   - `ensureSession` removes the just-created session from the
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
            this.sink.onTitle?.(session.ownerId, {
              sessionId: session.id,
              canonicalTitle: null,
            })
          }
        }

        if (session.render.title !== lastBroadcastTitle) {
          lastBroadcastTitle = session.render.title
          this.sink.onTitle?.(session.ownerId, {
            sessionId: session.id,
            canonicalTitle: session.render.title,
          })
        }
        this.sink.onOutput(session.ownerId, {
          sessionId: session.id,
          data,
          seq,
          processName: processNameAfterData,
        })
      }),
    )
    session.disposables.push(
      this.ptySupervisor.onExit(handle, () => {
        session.pty = null
        this.sink.onExit(session.ownerId, { sessionId: session.id })
        this.closeSession(session.id)
      }),
    )
    return this.attachResult(session)
  }

  private disposeSessionResources(session: TerminalSession<TOwner>): void {
    disposeSessionListeners(session)
    if (session.pty) {
      try {
        this.ptySupervisor.kill(session.pty)
      } catch (err) {
        sessionManagerLogger.warn({ sessionId: session.id, err }, 'failed to kill PTY')
      }
    }
    session.pty = null
    session.inputQueue = []
    session.inputFlushScheduled = false
  }

  private scheduleInputFlush(session: TerminalSession<TOwner>): void {
    if (session.inputFlushScheduled || session.inputQueue.length === 0 || !session.pty) return
    session.inputFlushScheduled = true
    queueMicrotask(() => {
      session.inputFlushScheduled = false
      this.drainInputQueue(session)
    })
  }

  private drainInputQueue(session: TerminalSession<TOwner>): void {
    if (session.inputQueue.length === 0 || !session.pty) return
    const batch = session.inputQueue.splice(0).join('')
    try {
      this.ptySupervisor.write(session.pty, batch)
    } catch (err) {
      sessionManagerLogger.warn({ sessionId: session.id, err, bytes: batch.length }, 'failed to write PTY')
    }
  }

  private isValidOwnerId(ownerId: TOwner): boolean {
    return (
      (typeof ownerId === 'number' && Number.isSafeInteger(ownerId) && ownerId > 0) ||
      (typeof ownerId === 'string' && ownerId.length > 0)
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

function disposeSessionListeners<TOwner extends string | number>(session: TerminalSession<TOwner>): void {
  for (const disposable of session.disposables.splice(0)) {
    try {
      disposable.dispose()
    } catch (err) {
      sessionManagerLogger.warn({ sessionId: session.id, err }, 'failed to dispose PTY listener')
    }
  }
}

function createSessionId(): string {
  return `term_${crypto.randomUUID()}`
}

function parseWorktreePathFromKey(key: string): string | null {
  return parseTerminalSessionKey(key)?.worktreePath ?? null
}
