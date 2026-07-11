import path from 'node:path'
import {
  type TerminalAttachResult,
  type TerminalBellRealtimeEvent,
  type TerminalController,
  type TerminalExitEvent,
  type TerminalIdentityEvent,
  type TerminalHydrationSnapshot,
  type TerminalLifecycleEvent,
  type TerminalOutputEvent,
  type TerminalSessionSummary,
  type TerminalSessionsSnapshot,
  type TerminalTakeoverResult,
  type TerminalTitleEvent,
} from '#/shared/terminal-types.ts'
import { isValidTerminalRuntimeSessionId, normalizeTerminalSize } from '#/shared/terminal-validators.ts'
import { createOpaqueId } from '#/shared/opaque-id.ts'
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
import { createEmptyTerminalRenderState, replaySnapshot } from '#/server/terminal/terminal-render-state.ts'
import { markTerminalSessionClosed, markTerminalSessionError } from '#/server/terminal/terminal-session-lifecycle.ts'
import {
  TerminalPtyBinding,
  type TerminalPtySessionState,
  type TerminalPtySpawnResult,
} from '#/server/terminal/terminal-session-pty-lifecycle.ts'
import type { PtySupervisor } from '#/server/terminal/pty-supervisor.ts'
import {
  physicalWorktreeIdentityKey,
} from '#/server/worktree-removal/physical-worktree-identity.ts'
import type { PhysicalWorktreeCapability } from '#/server/worktree-removal/physical-worktree-identity-resolver.ts'
import type { TerminalSessionEnsureAttachResult } from '#/server/terminal/terminal-session-ensurer.ts'

const MAX_TERMINAL_WRITE_CHARS = 1024 * 1024

export interface TerminalSessionOrderProjection<TUser extends string | number> {
  terminalSessionIds(input: { userId: TUser; scope: string; worktreePath: string }): readonly string[]
}

export type TerminalSessionCloseReason = 'session' | 'scope' | 'detached-user' | 'shutdown'

interface TerminalPtyAttachResult {
  generation: number
  result: TerminalSessionEnsureAttachResult
}

export interface TerminalEnsureSessionInput<TUser extends string | number> {
  userId: TUser
  scope: string
  repoRoot: string
  repoRuntimeId: string
  branch: string
  terminalSessionId: string
  worktreePath: string
  physicalWorktreeCapability: PhysicalWorktreeCapability
  cwd: string
  cols: number
  rows: number
  clientId?: string
  command?: string
  args?: string[]
  startupShellCommand?: string
  env?: Record<string, string>
  signal?: AbortSignal
}

interface TerminalSessionView<TUser extends string | number> extends TerminalPtySessionState<TUser> {
  repoRoot: string
  repoRuntimeId: string
  scope: string
  branch: string
  terminalSessionId: string
  worktreePath: string
  physicalWorktreeCapability: PhysicalWorktreeCapability
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
  onBell?(userId: TUser, event: TerminalBellRealtimeEvent): void
  onTitle?(userId: TUser, event: TerminalTitleEvent): void
  onExit(userId: TUser, event: TerminalExitEvent): void
  onSessionClosed?(userId: TUser, session: TerminalSessionSummary, reason: TerminalSessionCloseReason): void
  // Identity and lifecycle are emitted on separate channels so the
  // client's teardown decision can subscribe to identity only.
  // A transitional phase update arrives as `onLifecycle` and never
  // looks like a role change.
  onIdentity?(userId: TUser, event: TerminalIdentityEvent): void
  onLifecycle?(userId: TUser, event: TerminalLifecycleEvent): void
}

export interface TerminalPhysicalWorktreeScope<TUser extends string | number> {
  userId: TUser
  scope: string
}

export type TerminalPhysicalWorktreeQuiescenceResult<TUser extends string | number> =
  | { ok: true; scopes: TerminalPhysicalWorktreeScope<TUser>[] }
  | { ok: false; scopes: TerminalPhysicalWorktreeScope<TUser>[]; message: string }

export class TerminalSessionManager<TUser extends string | number> {
  private readonly sessionsByTerminalRuntimeSessionId = new Map<string, TerminalSessionView<TUser>>()
  private readonly terminalRuntimeSessionIdByUserTerminalSessionIndex = new Map<string, string>()
  private readonly closeOperationsByTerminalRuntimeSessionId = new Map<string, Promise<boolean>>()
  private readonly projectionRevisionByUserScope = new Map<string, number>()
  private readonly projectedProcessNameByTerminalRuntimeSessionId = new Map<string, string>()
  private readonly sink: TerminalEventSink<TUser>
  private readonly ptySupervisor: PtySupervisor
  private readonly sessionOrder: TerminalSessionOrderProjection<TUser>
  private readonly isClientOnline: (userId: TUser, clientId: string) => boolean

  constructor(
    ptySupervisor: PtySupervisor,
    sink: TerminalEventSink<TUser>,
    sessionOrder: TerminalSessionOrderProjection<TUser>,
    isClientOnline: (userId: TUser, clientId: string) => boolean,
  ) {
    this.ptySupervisor = ptySupervisor
    this.sink = sink
    this.sessionOrder = sessionOrder
    this.isClientOnline = isClientOnline
  }

  async ensureSession(input: TerminalEnsureSessionInput<TUser>): Promise<TerminalSessionEnsureAttachResult> {
    if (input.signal?.aborted) return { ok: false, message: 'error.repo-runtime-stale' }
    const size = normalizeTerminalSize(input.cols, input.rows)
    if (!size) return { ok: false, message: 'error.invalid-arguments' }

    const cwd = path.resolve(input.cwd)
    const userId = input.userId
    if (!this.isValidUserId(userId)) return { ok: false, message: 'error.invalid-arguments' }
    const userTerminalSessionIndex = this.formatUserTerminalSessionIndex(userId, input.terminalSessionId)
    const existingId = this.terminalRuntimeSessionIdByUserTerminalSessionIndex.get(userTerminalSessionIndex)
    const existing = existingId ? this.sessionsByTerminalRuntimeSessionId.get(existingId) : undefined
    if (existing) {
      if (
        physicalWorktreeIdentityKey(existing.physicalWorktreeCapability.identity) !==
        physicalWorktreeIdentityKey(input.physicalWorktreeCapability.identity)
      ) {
        return { ok: false, message: 'error.invalid-worktree-identity' }
      }
      if (this.closeOperationsByTerminalRuntimeSessionId.has(existing.id)) {
        return { ok: false, message: 'error.unavailable' }
      }
      if (input.clientId) {
        registerTerminalClient(existing, input.clientId, size.cols, size.rows)
      }
      return await this.attachExistingSession(existing, input.clientId)
    }

    const worktreePath = input.worktreePath
    const id = createTerminalRuntimeSessionId()
    const session: TerminalSessionView<TUser> = {
      id,
      userId,
      repoRoot: input.repoRoot,
      repoRuntimeId: input.repoRuntimeId,
      scope: input.scope,
      branch: input.branch,
      terminalSessionId: input.terminalSessionId,
      worktreePath,
      physicalWorktreeCapability: input.physicalWorktreeCapability,
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
      terminalRuntimeGeneration: 0,
      // Travel on the lifecycle realtime event so a takeover
      // pending flag set on one tab can immediately disable the
      // write path on the others without an identity round-trip.
      takeoverPending: false,
    }
    this.sessionsByTerminalRuntimeSessionId.set(id, session)
    this.terminalRuntimeSessionIdByUserTerminalSessionIndex.set(userTerminalSessionIndex, id)
    this.projectedProcessNameByTerminalRuntimeSessionId.set(id, session.ptyBinding.processName())
    this.advanceProjectionRevision(session.userId, session.scope)
    if (input.clientId) {
      registerTerminalClient(session, input.clientId, size.cols, size.rows)
      this.applyIdentityEffect(session, attachTerminalClient(session, input.clientId, this.sessionPresence(session)))
    }
    const spawn = await this.spawnAndAttachSession(session, input.signal)
    if (!spawn.result.ok) {
      // Spawn failed: do not leave a zombie session in the maps. The
      // session service would otherwise find it on retry and surface it as a
      // successful attach with an empty buffer and a null pty — i.e.
      // a blank, non-responsive terminal. `closeSession` removes the
      // map entry and frees pty/listener resources via the standard
      // disposal path. Stale spawns are different: another close/restart
      // generation already owns the session, so this caller must not tear
      // down the current generation.
      if (session.ptyBinding.isCurrentSpawn(session, spawn.generation)) {
        const close = this.closeSession(id)
        if (!input.signal?.aborted) await close
      }
      return spawn.result
    }
    return spawn.result
  }

  writeSession(userId: TUser, terminalRuntimeSessionId: string, data: string, clientId: string): boolean {
    if (!isValidTerminalRuntimeSessionId(terminalRuntimeSessionId) || !isValidTerminalWriteData(data)) return false
    const session = this.getSession(userId, terminalRuntimeSessionId)
    if (this.isSessionClosing(terminalRuntimeSessionId)) return false
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
    terminalRuntimeSessionId: string,
    cols: number,
    rows: number,
    clientId: string,
    signal?: AbortSignal,
  ): Promise<TerminalAttachResult> {
    if (!isValidTerminalRuntimeSessionId(terminalRuntimeSessionId))
      return { ok: false, message: 'error.invalid-arguments' }
    const size = normalizeTerminalSize(cols, rows)
    if (!size) return { ok: false, message: 'error.invalid-arguments' }
    const session = this.getSession(userId, terminalRuntimeSessionId)
    if (!session) return { ok: false, message: 'error.invalid-arguments' }
    if (this.isSessionClosing(terminalRuntimeSessionId)) return { ok: false, message: 'error.unavailable' }
    registerTerminalClient(session, clientId, size.cols, size.rows)
    const pending = await session.ptyBinding.waitForPendingSpawn(session)
    if (pending) return pending
    if (!this.isLiveSession(session)) return { ok: false, message: 'error.unavailable' }
    this.applyIdentityEffect(session, attachTerminalClient(session, clientId, this.sessionPresence(session)))
    return await this.attachResult(session)
  }

  resizeSession(
    userId: TUser,
    terminalRuntimeSessionId: string,
    cols: number,
    rows: number,
    clientId: string,
  ): boolean {
    if (!isValidTerminalRuntimeSessionId(terminalRuntimeSessionId)) return false
    const size = normalizeTerminalSize(cols, rows)
    if (!size) return false
    const session = this.getSession(userId, terminalRuntimeSessionId)
    if (!session) return false
    if (this.isSessionClosing(terminalRuntimeSessionId)) return false
    registerTerminalClient(session, clientId, size.cols, size.rows)
    if (!isAuthoritative(session, clientId, 'resize', this.sessionPresence(session))) return false
    return this.resizeSessionPty(session, size.cols, size.rows)
  }

  takeoverSession(
    userId: TUser,
    terminalRuntimeSessionId: string,
    cols: number,
    rows: number,
    clientId: string,
  ): TerminalTakeoverResult {
    if (!isValidTerminalRuntimeSessionId(terminalRuntimeSessionId))
      return { ok: false, message: 'error.invalid-arguments' }
    const size = normalizeTerminalSize(cols, rows)
    if (!size) return { ok: false, message: 'error.invalid-arguments' }
    const session = this.getSession(userId, terminalRuntimeSessionId)
    if (!session) return { ok: false, message: 'error.invalid-arguments' }
    if (this.isSessionClosing(terminalRuntimeSessionId)) return { ok: false, message: 'error.unavailable' }
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
    terminalRuntimeSessionId: string,
    cols: number,
    rows: number,
    clientId: string,
    signal?: AbortSignal,
  ): Promise<TerminalAttachResult> {
    if (!isValidTerminalRuntimeSessionId(terminalRuntimeSessionId))
      return { ok: false, message: 'error.invalid-arguments' }
    const size = normalizeTerminalSize(cols, rows)
    if (!size) return { ok: false, message: 'error.invalid-arguments' }
    const session = this.getSession(userId, terminalRuntimeSessionId)
    if (!session) return { ok: false, message: 'error.invalid-arguments' }
    if (this.isSessionClosing(terminalRuntimeSessionId)) return { ok: false, message: 'error.unavailable' }
    registerTerminalClient(session, clientId, size.cols, size.rows)
    const denyReason = explainAuthority(session, clientId, 'restart', this.sessionPresence(session))
    if (denyReason !== null) {
      return { ok: false, message: authorityReasonToMessage(denyReason) }
    }
    restartTerminalClientControl(session, clientId, this.sessionPresence(session))
    if (signal?.aborted) return { ok: false, message: 'error.repo-runtime-stale' }
    const spawn = await this.restartAndAttachSession(session, size.cols, size.rows, signal)
    if (!spawn.result.ok && session.ptyBinding.isCurrentSpawn(session, spawn.generation)) {
      if (markTerminalSessionError(session, spawn.result.message)) this.emitLifecycle(session)
    }
    return spawn.result
  }

  async closeSessionForUser(userId: TUser, terminalRuntimeSessionId: string): Promise<boolean> {
    if (!this.getSession(userId, terminalRuntimeSessionId)) return false
    return await this.closeSession(terminalRuntimeSessionId)
  }

  async closeSession(
    terminalRuntimeSessionId: string,
    reason: TerminalSessionCloseReason = 'session',
  ): Promise<boolean> {
    const existing = this.closeOperationsByTerminalRuntimeSessionId.get(terminalRuntimeSessionId)
    if (existing) return await existing
    const session = this.sessionsByTerminalRuntimeSessionId.get(terminalRuntimeSessionId)
    if (!session) return false
    // Publish the single-flight operation before disposal can synchronously
    // deliver PTY exit and re-enter closeSession through the lifecycle sink.
    const operation = Promise.resolve().then(async () => await this.closeSessionAndWait(session, reason))
    this.closeOperationsByTerminalRuntimeSessionId.set(terminalRuntimeSessionId, operation)
    try {
      return await operation
    } finally {
      if (this.closeOperationsByTerminalRuntimeSessionId.get(terminalRuntimeSessionId) === operation) {
        this.closeOperationsByTerminalRuntimeSessionId.delete(terminalRuntimeSessionId)
      }
    }
  }

  private async closeSessionAndWait(
    session: TerminalSessionView<TUser>,
    reason: TerminalSessionCloseReason,
  ): Promise<boolean> {
    session.ptyBinding.invalidateOwnership()
    try {
      await session.ptyBinding.disposeAndWait(session)
    } catch (error) {
      if (markTerminalSessionError(session, error instanceof Error ? error.message : String(error))) {
        this.emitLifecycle(session)
      }
      return false
    }
    if (this.sessionsByTerminalRuntimeSessionId.get(session.id) !== session) return true
    const closedSession = this.detachSession(session)
    this.sink.onSessionClosed?.(session.userId, closedSession, reason)
    return true
  }

  private detachSession(session: TerminalSessionView<TUser>): TerminalSessionSummary {
    session.ptyBinding.invalidateOwnership()
    if (markTerminalSessionClosed(session)) this.emitLifecycle(session)
    const closedSession = this.sessionSummary(session)
    this.sessionsByTerminalRuntimeSessionId.delete(session.id)
    this.projectedProcessNameByTerminalRuntimeSessionId.delete(session.id)
    const userTerminalSessionIndex = this.formatUserTerminalSessionIndex(session.userId, session.terminalSessionId)
    if (this.terminalRuntimeSessionIdByUserTerminalSessionIndex.get(userTerminalSessionIndex) === session.id)
      this.terminalRuntimeSessionIdByUserTerminalSessionIndex.delete(userTerminalSessionIndex)
    this.advanceProjectionRevision(session.userId, session.scope)
    return closedSession
  }

  async closeSessionsForUser(userId: TUser): Promise<boolean> {
    const sessions = Array.from(this.sessionsByTerminalRuntimeSessionId.values()).filter(
      (session) => session.userId === userId,
    )
    const results = await Promise.all(
      sessions.map(async (session) => await this.closeSession(session.id, 'detached-user')),
    )
    return results.every(Boolean)
  }

  async closeSessionsForRepo(userId: TUser, scope: string): Promise<boolean> {
    const sessions = Array.from(this.sessionsByTerminalRuntimeSessionId.values()).filter(
      (session) => session.userId === userId && session.scope === scope,
    )
    const results = await Promise.all(sessions.map(async (session) => await this.closeSession(session.id, 'scope')))
    return results.every(Boolean)
  }

  /**
   * Releases the terminal projection clock after its repo-runtime epoch has
   * been invalidated. Ordinary projection cleanup must retain the clock so a
   * delayed response from the same epoch cannot become fresh again.
   */
  releaseProjectionRevisionForScope(userId: TUser, scope: string): void {
    const hasLiveSession = Array.from(this.sessionsByTerminalRuntimeSessionId.values()).some(
      (session) => session.userId === userId && session.scope === scope,
    )
    if (hasLiveSession) throw new Error('cannot release terminal projection revision with live sessions')
    this.clearProjectionRevision(userId, scope)
  }

  getPhysicalWorktreeCapabilityForUser(
    userId: TUser,
    terminalRuntimeSessionId: string,
  ): PhysicalWorktreeCapability | null {
    return this.getSession(userId, terminalRuntimeSessionId)?.physicalWorktreeCapability ?? null
  }

  async closeSessionsForPhysicalWorktree(
    capability: PhysicalWorktreeCapability,
  ): Promise<TerminalPhysicalWorktreeQuiescenceResult<TUser>> {
    const targetKey = physicalWorktreeIdentityKey(capability.identity)
    const affected = new Map<string, TerminalPhysicalWorktreeScope<TUser>>()
    for (const session of Array.from(this.sessionsByTerminalRuntimeSessionId.values())) {
      const sessionKey = physicalWorktreeIdentityKey(session.physicalWorktreeCapability.identity)
      if (sessionKey !== targetKey) continue
      const key = `${String(session.userId)}\0${session.scope}`
      affected.set(key, { userId: session.userId, scope: session.scope })
      const closed = await this.closeSession(session.id, 'scope')
      if (!closed && this.sessionsByTerminalRuntimeSessionId.get(session.id) === session) {
        return {
          ok: false,
          scopes: Array.from(affected.values()),
          message: session.message ?? 'error.unavailable',
        }
      }
    }
    return { ok: true, scopes: Array.from(affected.values()) }
  }

  handleClientPresenceChanged(userId: TUser, clientId: string, previousOnline: boolean): void {
    for (const session of Array.from(this.sessionsByTerminalRuntimeSessionId.values())) {
      if (session.userId !== userId) continue
      if (!session.attachments.has(clientId) && session.controllerClientId !== clientId) continue
      const previousController = this.effectiveControllerWithOverride(session, clientId, previousOnline)
      if (terminalIdentityChanged(session, previousController, this.sessionPresence(session)))
        this.emitIdentity(session)
    }
  }

  forceCloseAllForShutdown(): void {
    for (const session of Array.from(this.sessionsByTerminalRuntimeSessionId.values())) {
      const closedSession = this.detachSession(session)
      session.ptyBinding.dispose(session)
      this.sink.onSessionClosed?.(session.userId, closedSession, 'shutdown')
    }
  }

  async listSessionsForUser(userId: TUser, scope: string): Promise<TerminalSessionSummary[]> {
    const sessionsByWorktree = new Map<string, TerminalSessionView<TUser>[]>()
    for (const session of Array.from(this.sessionsByTerminalRuntimeSessionId.values())) {
      if (session.userId === userId && session.scope === scope) {
        const current = sessionsByWorktree.get(session.worktreePath)
        if (current) current.push(session)
        else sessionsByWorktree.set(session.worktreePath, [session])
      }
    }
    return Array.from(sessionsByWorktree.entries()).flatMap(([worktreePath, sessions]) =>
      this.sessionsForWorktreeTabs(userId, scope, worktreePath, sessions).map((session) => ({
        terminalRuntimeSessionId: session.id,
      terminalRuntimeGeneration: session.terminalRuntimeGeneration,
        terminalSessionId: session.terminalSessionId,
        repoRuntimeId: session.repoRuntimeId,
        repoRoot: session.repoRoot,
        branch: session.branch,
        worktreePath: session.worktreePath,
        cwd: session.cwd,
        controller: this.effectiveController(session),
        processName: session.ptyBinding.processName(),
        canonicalTitle: session.render.title,
        phase: session.phase,
        message: session.message,
        cols: session.cols,
        rows: session.rows,
      })),
    )
  }

  terminalSessionsSnapshotForUser(userId: TUser, scope: string): TerminalSessionsSnapshot {
    const sessions = Array.from(this.sessionsByTerminalRuntimeSessionId.values()).flatMap((session) =>
      session.userId === userId && session.scope === scope ? [this.sessionSummary(session)] : [],
    )
    return { revision: this.projectionRevision(userId, scope), sessions }
  }

  async recoverSessionsForUser(
    userId: TUser,
    scope: string,
  ): Promise<{ terminalSessions: TerminalSessionsSnapshot; snapshots: TerminalHydrationSnapshot[] }> {
    const terminalSessions = this.terminalSessionsSnapshotForUser(userId, scope)
    const snapshots: TerminalHydrationSnapshot[] = []
    for (const summary of terminalSessions.sessions) {
      const session = this.getSession(userId, summary.terminalRuntimeSessionId)
      if (!session) continue
      const snap = await replaySnapshot(session.render)
      if (!snap) continue
      snapshots.push({
        terminalRuntimeSessionId: summary.terminalRuntimeSessionId,
        terminalRuntimeGeneration: summary.terminalRuntimeGeneration,
        snapshot: snap.snapshot,
        snapshotSeq: snap.snapshotSeq,
        outputEra: snap.outputEra,
      })
    }
    return { terminalSessions, snapshots }
  }

  getSessionSummaryForUser(userId: TUser, terminalRuntimeSessionId: string): TerminalSessionSummary | null {
    const session = this.getSession(userId, terminalRuntimeSessionId)
    return session ? this.sessionSummary(session) : null
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
    for (const session of this.sessionsByTerminalRuntimeSessionId.values()) {
      count += 1
      const chars = session.render.buffer.length
      totalBufferChars += chars
      if (chars > maxBufferChars) maxBufferChars = chars
    }
    return { count, totalBufferChars, maxBufferChars }
  }

  private sessionsForWorktreeTabs(
    userId: TUser,
    scope: string,
    worktreePath: string,
    sessions: readonly TerminalSessionView<TUser>[],
  ): TerminalSessionView<TUser>[] {
    const terminalSessionByTerminalSessionId = new Map(sessions.map((session) => [session.terminalSessionId, session]))
    const seen = new Set<string>()
    const tabListedSessions: TerminalSessionView<TUser>[] = []
    for (const terminalSessionId of this.sessionOrder.terminalSessionIds({ userId, scope, worktreePath })) {
      const session = terminalSessionByTerminalSessionId.get(terminalSessionId)
      if (!session || seen.has(terminalSessionId)) continue
      seen.add(terminalSessionId)
      tabListedSessions.push(session)
    }
    for (const session of sessions) {
      if (seen.has(session.terminalSessionId)) continue
      seen.add(session.terminalSessionId)
      tabListedSessions.push(session)
    }
    return tabListedSessions
  }

  private sessionSummary(session: TerminalSessionView<TUser>): TerminalSessionSummary {
    return {
      terminalRuntimeSessionId: session.id,
      terminalRuntimeGeneration: session.terminalRuntimeGeneration,
      terminalSessionId: session.terminalSessionId,
      repoRuntimeId: session.repoRuntimeId,
      repoRoot: session.repoRoot,
      branch: session.branch,
      worktreePath: session.worktreePath,
      cwd: session.cwd,
      controller: this.effectiveController(session),
      processName: session.ptyBinding.processName(),
      canonicalTitle: session.render.title,
      phase: session.phase,
      message: session.message,
      cols: session.cols,
      rows: session.rows,
    }
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
      terminalRuntimeSessionId: session.id,
      terminalRuntimeGeneration: session.terminalRuntimeGeneration,
      role: 'controller',
      controllerStatus: 'connected',
      controller: this.effectiveController(session),
      canonicalCols: session.cols,
      canonicalRows: session.rows,
      phase: session.phase,
    }
  }

  private async attachResult(session: TerminalSessionView<TUser>): Promise<TerminalSessionEnsureAttachResult> {
    const snap = await replaySnapshot(session.render)
    if (!snap) return { ok: false, message: 'error.unavailable' }
    return {
      ok: true,
      terminalSessionsRevision: this.projectionRevision(session.userId, session.scope),
      terminalRuntimeSessionId: session.id,
      terminalRuntimeGeneration: session.terminalRuntimeGeneration,
      snapshot: snap.snapshot,
      snapshotSeq: snap.snapshotSeq,
      outputEra: snap.outputEra,
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
  ): Promise<TerminalSessionEnsureAttachResult> {
    const pending = await session.ptyBinding.waitForPendingSpawn(session)
    if (pending) return pending
    if (!this.isLiveSession(session)) return { ok: false, message: 'error.unavailable' }
    if (clientId)
      this.applyIdentityEffect(session, attachTerminalClient(session, clientId, this.sessionPresence(session)))
    return await this.attachResult(session)
  }

  private formatUserTerminalSessionIndex(userId: TUser, terminalSessionId: string): string {
    return `${String(userId)}\0${terminalSessionId}`
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

  // Realtime events are addressed by `terminalRuntimeSessionId` (the runtime lookup
  // id) *and* `terminalSessionId` (the durable tab identity) — see the
  // naming-boundary note on the realtime event types in
  // `#/shared/terminal-types.ts`. Every emit path funnels through one of
  // these two helpers so a future event type cannot be added without the
  // `terminalSessionId` a client needs to route it reliably.
  private terminalSessionIdentity(session: TerminalSessionView<TUser>): { terminalSessionId: string } {
    return { terminalSessionId: session.terminalSessionId }
  }

  private terminalSessionPublicScope(session: TerminalSessionView<TUser>): {
    terminalSessionId: string
    repoRoot: string
    worktreePath: string
  } {
    return {
      terminalSessionId: session.terminalSessionId,
      repoRoot: session.repoRoot,
      worktreePath: session.worktreePath,
    }
  }

  private emitIdentity(session: TerminalSessionView<TUser>): void {
    this.advanceProjectionRevision(session.userId, session.scope)
    this.sink.onIdentity?.(session.userId, {
      terminalRuntimeSessionId: session.id,
      terminalRuntimeGeneration: session.terminalRuntimeGeneration,
      ...this.terminalSessionIdentity(session),
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
    this.advanceProjectionRevision(session.userId, session.scope)
    this.sink.onLifecycle?.(session.userId, {
      terminalRuntimeSessionId: session.id,
      terminalRuntimeGeneration: session.terminalRuntimeGeneration,
      ...this.terminalSessionIdentity(session),
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

  private async restartAndAttachSession(
    session: TerminalSessionView<TUser>,
    cols: number,
    rows: number,
    signal?: AbortSignal,
  ): Promise<TerminalPtyAttachResult> {
    const spawn = await session.ptyBinding.restart(session, cols, rows, 'restarting', signal)
    return await this.finishSpawnAndAttachSession(session, spawn)
  }

  private async spawnAndAttachSession(
    session: TerminalSessionView<TUser>,
    signal?: AbortSignal,
  ): Promise<TerminalPtyAttachResult> {
    const spawn = await session.ptyBinding.spawn(session, signal)
    return await this.finishSpawnAndAttachSession(session, spawn)
  }

  private async finishSpawnAndAttachSession(
    session: TerminalSessionView<TUser>,
    spawn: TerminalPtySpawnResult,
  ): Promise<TerminalPtyAttachResult> {
    if (!spawn.result.ok) return { generation: spawn.generation, result: spawn.result }
    this.projectedProcessNameByTerminalRuntimeSessionId.set(session.id, session.ptyBinding.processName())
    this.advanceProjectionRevision(session.userId, session.scope)
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
      emitOutput: (session, event) => {
        this.advanceProjectionRevisionForProcessName(session, event.processName)
        this.sink.onOutput(session.userId, { ...event, ...this.terminalSessionIdentity(session) })
      },
      emitBell: (session, event) =>
        this.sink.onBell?.(session.userId, { ...event, ...this.terminalSessionPublicScope(session) }),
      emitTitle: (session, event) => {
        this.advanceProjectionRevision(session.userId, session.scope)
        this.sink.onTitle?.(session.userId, { ...event, ...this.terminalSessionPublicScope(session) })
      },
      emitExit: (session, event) =>
        this.sink.onExit(session.userId, {
          ...event,
          ...this.terminalSessionIdentity(session),
          repoRoot: session.repoRoot,
          repoRuntimeId: session.repoRuntimeId,
        }),
      closeSession: (terminalRuntimeSessionId) => {
        void this.closeSession(terminalRuntimeSessionId)
      },
    })
  }

  private isLiveSession(session: TerminalSessionView<TUser>): boolean {
    return this.sessionsByTerminalRuntimeSessionId.get(session.id) === session
  }

  private isSessionClosing(terminalRuntimeSessionId: string): boolean {
    return this.closeOperationsByTerminalRuntimeSessionId.has(terminalRuntimeSessionId)
  }

  private projectionRevision(userId: TUser, scope: string): number {
    return this.projectionRevisionByUserScope.get(this.projectionRevisionKey(userId, scope)) ?? 0
  }

  private advanceProjectionRevision(userId: TUser, scope: string): void {
    const key = this.projectionRevisionKey(userId, scope)
    this.projectionRevisionByUserScope.set(key, (this.projectionRevisionByUserScope.get(key) ?? 0) + 1)
  }

  private advanceProjectionRevisionForProcessName(session: TerminalSessionView<TUser>, processName: string): void {
    if (this.projectedProcessNameByTerminalRuntimeSessionId.get(session.id) === processName) return
    this.projectedProcessNameByTerminalRuntimeSessionId.set(session.id, processName)
    this.advanceProjectionRevision(session.userId, session.scope)
  }

  private clearProjectionRevision(userId: TUser, scope: string): void {
    this.projectionRevisionByUserScope.delete(this.projectionRevisionKey(userId, scope))
  }

  private projectionRevisionKey(userId: TUser, scope: string): string {
    return `${String(userId)}\0${scope}`
  }

  private getSession(userId: TUser, terminalRuntimeSessionId: string): TerminalSessionView<TUser> | undefined {
    if (!this.isValidUserId(userId) || !isValidTerminalRuntimeSessionId(terminalRuntimeSessionId)) return undefined
    const session = this.sessionsByTerminalRuntimeSessionId.get(terminalRuntimeSessionId)
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

function createTerminalRuntimeSessionId(): string {
  return createOpaqueId('pty')
}
