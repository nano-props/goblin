import path from 'node:path'
import {
  type TerminalAttachResult,
  type TerminalBellRealtimeEvent,
  type TerminalController,
  type TerminalCreateAction,
  type TerminalExitEvent,
  type TerminalExecutionTarget,
  terminalExecutionCoordinates,
  type TerminalIdentityEvent,
  type TerminalLifecycleEvent,
  type TerminalOutputEvent,
  type TerminalPresentation,
  type TerminalRestartResult,
  type TerminalRuntimeMetadata,
  type TerminalSessionSummary,
  type TerminalSessionsChangedEvent,
  type TerminalSessionsSnapshot,
  type TerminalTakeoverResult,
  type TerminalTitleEvent,
  type TerminalWriteResult,
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
  type TerminalControllerEffect,
  type TerminalControllerState,
} from '#/server/terminal/terminal-controller.ts'
import { createEmptyTerminalRenderState, replaySnapshot } from '#/server/terminal/terminal-render-state.ts'
import { markTerminalSessionClosed, markTerminalSessionError } from '#/server/terminal/terminal-session-lifecycle.ts'
import {
  TerminalPtyBinding,
  type TerminalPtySessionState,
  type TerminalPtySpawnResult,
} from '#/server/terminal/terminal-session-pty-lifecycle.ts'
import type { PtySupervisor } from '#/server/terminal/pty-supervisor.ts'
import { physicalWorktreeIdentityKey } from '#/server/worktree-removal/physical-worktree-identity.ts'
import type { PhysicalWorktreeExecutionCapability } from '#/server/worktree-removal/physical-worktree-capability.ts'
import { TerminalDirectory } from '#/server/terminal/terminal-directory.ts'
import { terminalSessionRuntimeScope } from '#/server/terminal/terminal-session-scope.ts'
import type { TerminalSessionAdmission } from '#/server/terminal/terminal-session-ensurer.ts'
import { serverLogger } from '#/server/logger.ts'
import { canonicalWorkspaceLocator, type WorkspaceId } from '#/shared/workspace-locator.ts'

const MAX_TERMINAL_WRITE_CHARS = 1024 * 1024
const INVALIDATED_SESSION_RETIREMENT_RETRY_BASE_MS = 100
const INVALIDATED_SESSION_RETIREMENT_RETRY_MAX_MS = 5_000
const terminalSessionManagerLogger = serverLogger.child({ module: 'terminal-session-manager' })

export type TerminalSessionCloseReason = 'session' | 'scope' | 'detached-user' | 'shutdown'

interface TerminalPtyRestartResult {
  generation: number
  result: Extract<TerminalAttachResult, { ok: true; frame: 'snapshot' }> | { ok: false; message: string }
}

export type TerminalSessionPrepareResult =
  { ok: true; terminalRuntimeSessionId: string; admission: TerminalSessionAdmission } | { ok: false; message: string }

export interface TerminalEnsureSessionInput<TUser extends string | number> {
  userId: TUser
  terminalSessionId: string
  physicalWorktreeCapability: PhysicalWorktreeExecutionCapability
  cwd: string
  cols: number
  rows: number
  clientId?: string
  command?: string
  args?: string[]
  startupShellCommand?: string
  env?: Record<string, string>
  signal?: AbortSignal
  target: TerminalExecutionTarget
}

interface TerminalSessionView<TUser extends string | number> extends TerminalPtySessionState<TUser> {
  scope: string
  presentation: TerminalPresentation | null
  terminalSessionId: string
  readonly worktreeId: WorkspaceId
  target: TerminalExecutionTarget
  physicalWorktreeCapability: PhysicalWorktreeExecutionCapability
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
  /**
   * The authoritative sessions projection changed in a way that cannot be
   * reconstructed from incremental terminal events alone.
   */
  onSessionsProjectionChanged?(userId: TUser, event: TerminalSessionsChangedEvent): void
}

export interface TerminalPhysicalWorktreeScope<TUser extends string | number> {
  userId: TUser
  workspaceId: WorkspaceId
  workspaceRuntimeId: string
  scope: string
}

export type TerminalPhysicalWorktreeQuiescenceResult<TUser extends string | number> =
  | { ok: true; scopes: TerminalPhysicalWorktreeScope<TUser>[] }
  | { ok: false; scopes: TerminalPhysicalWorktreeScope<TUser>[]; message: string }

export interface TerminalBatchRetirementResult {
  removedEffects: TerminalSessionSummary[]
  failures: Array<{ terminalRuntimeSessionId: string; message: string }>
}

export interface TerminalSessionInvalidationCommit {
  removedSessions: readonly TerminalSessionSummary[]
  removedCount: number
  publishEffects(): void
}

export class TerminalSessionManager<TUser extends string | number> {
  private readonly directory = new TerminalDirectory<TUser, TerminalSessionView<TUser>>()
  private readonly closeOperationsByTerminalRuntimeSessionId = new Map<string, Promise<boolean>>()
  private readonly invalidatedSessionRetirements = new Map<
    string,
    {
      session: TerminalSessionView<TUser>
      attempts: number
      running: boolean
      timer: ReturnType<typeof setTimeout> | null
    }
  >()
  private shuttingDown = false
  private readonly sink: TerminalEventSink<TUser>
  private readonly ptySupervisor: PtySupervisor
  private readonly isClientOnline: (userId: TUser, clientId: string) => boolean

  constructor(
    ptySupervisor: PtySupervisor,
    sink: TerminalEventSink<TUser>,
    isClientOnline: (userId: TUser, clientId: string) => boolean,
  ) {
    this.ptySupervisor = ptySupervisor
    this.sink = sink
    this.isClientOnline = isClientOnline
  }

  prepareSession(input: TerminalEnsureSessionInput<TUser>): TerminalSessionPrepareResult {
    if (input.signal?.aborted) return { ok: false, message: 'error.workspace-runtime-stale' }
    const size = normalizeTerminalSize(input.cols, input.rows)
    if (!size) return { ok: false, message: 'error.invalid-arguments' }

    const cwd = path.resolve(input.cwd)
    const userId = input.userId
    if (!this.isValidUserId(userId)) return { ok: false, message: 'error.invalid-arguments' }
    const coordinates = terminalExecutionCoordinates(input.target)
    const scope = terminalSessionRuntimeScope(coordinates.workspaceId, coordinates.workspaceRuntimeId)
    const existing = this.directory.getByDurableId(userId, input.terminalSessionId)
    if (existing) {
      if (!sameTerminalScope(existing, input)) {
        return { ok: false, message: 'error.invalid-arguments' }
      }
      if (
        physicalWorktreeIdentityKey(existing.physicalWorktreeCapability.identity) !==
        physicalWorktreeIdentityKey(input.physicalWorktreeCapability.identity)
      ) {
        return { ok: false, message: 'error.invalid-worktree-identity' }
      }
      if (!this.isSessionAvailableForAdmission(existing)) {
        return { ok: false, message: 'error.unavailable' }
      }
      let admissionState: 'pending' | 'committed' | 'aborted' = 'pending'
      let committedEffect: ReturnType<typeof attachTerminalClient> | null = null
      let presentationChanged = false
      let effectsPublished = false
      return {
        ok: true,
        terminalRuntimeSessionId: existing.id,
        admission: {
          kind: 'existing',
          commit: ({ presentation }) => {
            if (admissionState !== 'pending') throw new Error('error.unavailable')
            assertTerminalPresentationMatchesTarget(input.target, presentation)
            if (!this.isSessionAvailableForAdmission(existing)) {
              admissionState = 'aborted'
              throw new Error('error.unavailable')
            }
            const stagedController = this.stageAdmissionController(existing, input.clientId, size)
            const processName = existing.ptyBinding.processName()
            const action: TerminalCreateAction = stagedController.hadController ? 'restored' : 'reused'
            presentationChanged = !sameTerminalPresentation(existing.presentation, presentation)
            const commitSessionMutation = () => {
              existing.presentation = presentation
              committedEffect = this.commitStagedAdmissionController(existing, stagedController)
            }
            if (presentationChanged) this.directory.change(existing, commitSessionMutation)
            else commitSessionMutation()
            admissionState = 'committed'
            return {
              action,
              presentation,
              terminalProjectionEffect: presentationChanged
                ? { kind: 'delta', revision: this.projectionRevision(userId, scope) }
                : { kind: 'none' },
              ...this.runtimeMetadata(existing, stagedController.controller, processName),
            }
          },
          publishCommittedEffects: () => {
            if (admissionState !== 'committed' || effectsPublished) return
            effectsPublished = true
            if (committedEffect?.emitIdentity) this.emitIdentity(existing)
            if (presentationChanged) {
              this.sink.onSessionsProjectionChanged?.(existing.userId, this.sessionsChangedEvent(existing))
            }
          },
          abort: () => {
            if (admissionState !== 'pending') return
            admissionState = 'aborted'
          },
        },
      }
    }

    const id = createTerminalRuntimeSessionId()
    const session: TerminalSessionView<TUser> = {
      id,
      userId,
      scope,
      presentation: null,
      terminalSessionId: input.terminalSessionId,
      worktreeId: coordinates.worktreeId,
      target: input.target,
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
    const reservation = this.directory.reserve({
      id,
      userId,
      scope,
      terminalSessionId: input.terminalSessionId,
      worktreeId: coordinates.worktreeId,
    })
    if (!reservation) return { ok: false, message: 'error.unavailable' }
    let committedEffect: ReturnType<typeof attachTerminalClient> | null = null
    // Logical creation stops here. The selected client mounts and fits its
    // single xterm before `attachSession` starts the PTY with exact geometry.
    // Until admission commit, this operation-owned session is not addressable
    // and has no process or output history.
    let admissionState: 'pending' | 'committed' | 'aborted' = 'pending'
    let effectsPublished = false
    const admission: TerminalSessionAdmission = {
      kind: 'prepared',
      commit: ({ presentation }) => {
        if (admissionState !== 'pending') throw new Error('error.unavailable')
        assertTerminalPresentationMatchesTarget(input.target, presentation)
        const stagedController = this.stageAdmissionController(session, input.clientId, size)
        const processName = session.ptyBinding.processName()
        session.presentation = presentation
        committedEffect = this.commitStagedAdmissionController(session, stagedController)
        reservation.commit(session)
        admissionState = 'committed'
        return {
          action: 'created',
          presentation,
          terminalProjectionEffect: { kind: 'delta', revision: this.projectionRevision(userId, scope) },
          ...this.runtimeMetadata(session, stagedController.controller, processName),
        }
      },
      publishCommittedEffects: () => {
        if (admissionState !== 'committed' || effectsPublished) return
        effectsPublished = true
        if (committedEffect?.emitIdentity) this.emitIdentity(session)
        this.sink.onSessionsProjectionChanged?.(session.userId, this.sessionsChangedEvent(session))
      },
      abort: () => {
        if (admissionState !== 'pending') return
        admissionState = 'aborted'
        reservation.abort()
        session.ptyBinding.invalidateOwnership()
        session.ptyBinding.dispose(session)
      },
    }
    return {
      ok: true,
      terminalRuntimeSessionId: session.id,
      admission,
    }
  }

  async writeSession(
    userId: TUser,
    terminalRuntimeSessionId: string,
    data: string,
    clientId: string,
  ): Promise<TerminalWriteResult> {
    if (!isValidTerminalRuntimeSessionId(terminalRuntimeSessionId) || !isValidTerminalWriteData(data)) {
      return { status: 'rejected' }
    }
    const session = this.getSession(userId, terminalRuntimeSessionId)
    if (this.isSessionClosing(terminalRuntimeSessionId)) return { status: 'rejected' }
    if (!session?.ptyBinding.hasPty()) return { status: 'rejected' }
    if (session.phase !== 'open') return { status: 'rejected' }
    // Register the attachment first so a brand-new socket can satisfy
    // the unknown-attachment gate, then defer to the shared
    // authority helper so write/resize/restart stay in lockstep.
    registerTerminalClient(session, clientId, session.cols, session.rows)
    if (!isAuthoritative(session, clientId, 'write', this.sessionPresence(session))) return { status: 'rejected' }
    return await session.ptyBinding.write(session, data)
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
    if (session.ptyBinding.hasPendingSpawn()) {
      const pending = await session.ptyBinding.waitForPendingSpawn(session)
      if (pending && !pending.ok) return pending
    }
    if (!this.isLiveSession(session)) return { ok: false, message: 'error.unavailable' }
    const identityEffect = attachTerminalClient(session, clientId, this.sessionPresence(session))
    if (session.ptyBinding.hasPty()) {
      this.applyIdentityEffect(session, identityEffect)
      return await this.snapshotAttachResult(session)
    }
    if (signal?.aborted) return { ok: false, message: 'error.workspace-runtime-stale' }
    if (session.render.sequence !== 0) return { ok: false, message: 'error.unavailable' }

    // A prepared session has no history to recover. Spawn only after the
    // real xterm has reported its size, and let output sequence 1+ flow over
    // realtime after this response. If another live client still controls
    // the session, its registered geometry remains canonical.
    const controller = this.effectiveController(session)
    const controllerSize = controller ? session.attachments.get(controller.clientId) : undefined
    const spawnSize = controllerSize ?? size
    const spawn = await this.spawnFreshSession(session, spawnSize.cols, spawnSize.rows, signal)
    return spawn.result
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
  ): Promise<TerminalRestartResult> {
    return (
      await this.restartSessionWithProjectionOutcome(userId, terminalRuntimeSessionId, cols, rows, clientId, signal)
    ).result
  }

  async restartSessionWithProjectionOutcome(
    userId: TUser,
    terminalRuntimeSessionId: string,
    cols: number,
    rows: number,
    clientId: string,
    signal?: AbortSignal,
  ): Promise<{ result: TerminalRestartResult; projectionChanged: TerminalSessionsChangedEvent | null }> {
    if (!isValidTerminalRuntimeSessionId(terminalRuntimeSessionId))
      return { result: { ok: false, message: 'error.invalid-arguments' }, projectionChanged: null }
    const size = normalizeTerminalSize(cols, rows)
    if (!size) return { result: { ok: false, message: 'error.invalid-arguments' }, projectionChanged: null }
    const session = this.getSession(userId, terminalRuntimeSessionId)
    if (!session) return { result: { ok: false, message: 'error.invalid-arguments' }, projectionChanged: null }
    if (this.isSessionClosing(terminalRuntimeSessionId))
      return { result: { ok: false, message: 'error.unavailable' }, projectionChanged: null }
    registerTerminalClient(session, clientId, size.cols, size.rows)
    const denyReason = explainAuthority(session, clientId, 'restart', this.sessionPresence(session))
    if (denyReason !== null) {
      return { result: { ok: false, message: authorityReasonToMessage(denyReason) }, projectionChanged: null }
    }
    restartTerminalClientControl(session, clientId, this.sessionPresence(session))
    if (signal?.aborted)
      return { result: { ok: false, message: 'error.workspace-runtime-stale' }, projectionChanged: null }
    const spawn = await this.restartAndAttachSession(session, size.cols, size.rows, signal)
    if (!spawn.result.ok && session.ptyBinding.isCurrentSpawn(session, spawn.generation)) {
      if (markTerminalSessionError(session, spawn.result.message)) this.emitLifecycle(session)
    }
    let projectionChanged: TerminalSessionsChangedEvent | null = null
    if (this.isLiveSession(session) && session.ptyBinding.isCurrentSpawn(session, spawn.generation)) {
      // Restart replaces the runtime binding represented by the full sessions
      // projection. Advance its clock after the binding settles so the
      // following sessions-changed event cannot be mistaken for an equal,
      // already-applied catalog revision.
      this.directory.touch(session)
      projectionChanged = this.sessionsChangedEvent(session)
    }
    const result = spawn.result.ok
      ? {
          ...spawn.result,
          terminalProjectionEffect: {
            kind: 'delta' as const,
            revision: this.projectionRevision(session.userId, session.scope),
          },
        }
      : spawn.result
    return { result, projectionChanged }
  }

  async closeSessionForUser(userId: TUser, terminalRuntimeSessionId: string): Promise<boolean> {
    if (!this.getSession(userId, terminalRuntimeSessionId)) return false
    return await this.requestSessionRetirement(terminalRuntimeSessionId)
  }

  async requestSessionRetirement(
    terminalRuntimeSessionId: string,
    reason: TerminalSessionCloseReason = 'session',
  ): Promise<boolean> {
    const existing = this.closeOperationsByTerminalRuntimeSessionId.get(terminalRuntimeSessionId)
    if (existing) return await existing
    const session = this.directory.get(terminalRuntimeSessionId)
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
    if (this.directory.get(session.id) !== session) return true
    const closedSession = this.detachSession(session)
    this.sink.onSessionClosed?.(session.userId, closedSession, reason)
    return true
  }

  private detachSession(session: TerminalSessionView<TUser>): TerminalSessionSummary {
    session.ptyBinding.invalidateOwnership()
    if (markTerminalSessionClosed(session)) this.emitLifecycle(session)
    const summary = this.sessionSummary(session)
    this.directory.remove(session)
    return summary
  }

  private detachSessionAuthority(session: TerminalSessionView<TUser>): {
    summary: TerminalSessionSummary | null
    lifecycleChanged: boolean
  } {
    session.ptyBinding.invalidateOwnership()
    const lifecycleChanged = markTerminalSessionClosed(session)
    this.directory.remove(session)
    let summary: TerminalSessionSummary | null = null
    try {
      summary = this.sessionSummary(session)
    } catch (error) {
      terminalSessionManagerLogger.warn(
        { terminalRuntimeSessionId: session.id, err: error },
        'failed to stage invalidated terminal session summary',
      )
    }
    return { summary, lifecycleChanged }
  }

  async closeSessionsForUser(userId: TUser): Promise<TerminalBatchRetirementResult> {
    const sessions = Array.from(this.directory.entries()).filter((session) => session.userId === userId)
    return await this.retireSessions(sessions, 'detached-user')
  }

  commitWorkspaceRuntimeSessionInvalidation(userId: TUser, scope: string): TerminalSessionInvalidationCommit {
    return this.commitSessionInvalidation(userId, scope, () => true)
  }

  commitGitSessionInvalidation(userId: TUser, scope: string): TerminalSessionInvalidationCommit {
    return this.commitSessionInvalidation(userId, scope, (session) => session.target.kind !== 'workspace-root')
  }

  private commitSessionInvalidation(
    userId: TUser,
    scope: string,
    matches: (session: TerminalSessionView<TUser>) => boolean,
  ): TerminalSessionInvalidationCommit {
    const removed: Array<{
      session: TerminalSessionView<TUser>
      summary: TerminalSessionSummary | null
      lifecycleChanged: boolean
    }> = []
    for (const session of Array.from(this.directory.entries())) {
      if (session.userId !== userId || session.scope !== scope || !matches(session)) continue
      const detached = this.detachSessionAuthority(session)
      removed.push({ session, ...detached })
    }
    let effectsPublished = false
    return {
      removedSessions: removed.flatMap((entry) => (entry.summary ? [entry.summary] : [])),
      removedCount: removed.length,
      publishEffects: () => {
        if (effectsPublished) return
        effectsPublished = true
        for (const { session, summary, lifecycleChanged } of removed) {
          if (lifecycleChanged) {
            try {
              this.emitLifecycle(session)
            } catch (error) {
              terminalSessionManagerLogger.warn(
                { terminalRuntimeSessionId: session.id, err: error },
                'failed to publish invalidated terminal lifecycle',
              )
            }
          }
          if (summary) {
            try {
              this.sink.onSessionClosed?.(session.userId, summary, 'scope')
            } catch (error) {
              terminalSessionManagerLogger.warn(
                { terminalRuntimeSessionId: session.id, err: error },
                'failed to publish invalidated terminal close',
              )
            }
          } else {
            terminalSessionManagerLogger.warn(
              { terminalRuntimeSessionId: session.id },
              'skipped invalidated terminal close without staged summary',
            )
          }
          this.scheduleInvalidatedSessionResourceRetirement(session)
        }
      },
    }
  }

  private scheduleInvalidatedSessionResourceRetirement(session: TerminalSessionView<TUser>): void {
    if (this.shuttingDown) {
      try {
        session.ptyBinding.dispose(session)
      } catch (error) {
        terminalSessionManagerLogger.warn(
          { terminalRuntimeSessionId: session.id, err: error },
          'failed to dispose invalidated terminal after shutdown',
        )
      }
      return
    }
    if (this.invalidatedSessionRetirements.has(session.id)) return
    const retirement = { session, attempts: 0, running: false, timer: null }
    this.invalidatedSessionRetirements.set(session.id, retirement)
    void this.runInvalidatedSessionResourceRetirement(session.id, retirement)
  }

  private async runInvalidatedSessionResourceRetirement(
    terminalRuntimeSessionId: string,
    retirement: {
      session: TerminalSessionView<TUser>
      attempts: number
      running: boolean
      timer: ReturnType<typeof setTimeout> | null
    },
  ): Promise<void> {
    if (this.invalidatedSessionRetirements.get(terminalRuntimeSessionId) !== retirement || retirement.running) return
    retirement.running = true
    retirement.timer = null
    try {
      await retirement.session.ptyBinding.disposeAndWait(retirement.session)
      if (this.invalidatedSessionRetirements.get(terminalRuntimeSessionId) === retirement) {
        this.invalidatedSessionRetirements.delete(terminalRuntimeSessionId)
      }
    } catch (error) {
      retirement.attempts += 1
      terminalSessionManagerLogger.warn(
        { terminalRuntimeSessionId, attempt: retirement.attempts, err: error },
        'failed to retire invalidated terminal session resources; retrying',
      )
      if (this.invalidatedSessionRetirements.get(terminalRuntimeSessionId) !== retirement) return
      if (this.shuttingDown) {
        this.invalidatedSessionRetirements.delete(terminalRuntimeSessionId)
        return
      }
      const delay = Math.min(
        INVALIDATED_SESSION_RETIREMENT_RETRY_BASE_MS * 2 ** Math.min(retirement.attempts - 1, 6),
        INVALIDATED_SESSION_RETIREMENT_RETRY_MAX_MS,
      )
      retirement.timer = setTimeout(() => {
        retirement.timer = null
        void this.runInvalidatedSessionResourceRetirement(terminalRuntimeSessionId, retirement)
      }, delay)
      retirement.timer.unref?.()
    } finally {
      retirement.running = false
    }
  }

  private async retireSessions(
    sessions: readonly TerminalSessionView<TUser>[],
    reason: TerminalSessionCloseReason,
  ): Promise<TerminalBatchRetirementResult> {
    const removedEffects: TerminalSessionSummary[] = []
    const failures: TerminalBatchRetirementResult['failures'] = []
    for (const session of sessions) {
      const summary = this.sessionSummary(session)
      if (await this.requestSessionRetirement(session.id, reason)) removedEffects.push(summary)
      else failures.push({ terminalRuntimeSessionId: session.id, message: session.message ?? 'error.unavailable' })
    }
    return { removedEffects, failures }
  }

  /**
   * Releases the terminal projection clock after its repo-runtime epoch has
   * been invalidated. Ordinary projection cleanup must retain the clock so a
   * delayed response from the same epoch cannot become fresh again.
   */
  releaseProjectionRevisionForScope(userId: TUser, scope: string): void {
    this.directory.releaseScope(userId, scope)
  }

  getPhysicalWorktreeExecutionCapabilityForUser(
    userId: TUser,
    terminalRuntimeSessionId: string,
  ): PhysicalWorktreeExecutionCapability | null {
    return this.getSession(userId, terminalRuntimeSessionId)?.physicalWorktreeCapability ?? null
  }

  async closeSessionsForPhysicalWorktree(
    capability: PhysicalWorktreeExecutionCapability,
  ): Promise<TerminalPhysicalWorktreeQuiescenceResult<TUser>> {
    const targetKey = physicalWorktreeIdentityKey(capability.identity)
    const affected = new Map<string, TerminalPhysicalWorktreeScope<TUser>>()
    for (const session of Array.from(this.directory.entries())) {
      const sessionKey = physicalWorktreeIdentityKey(session.physicalWorktreeCapability.identity)
      if (sessionKey !== targetKey) continue
      const key = `${String(session.userId)}\0${session.scope}`
      const coordinates = terminalExecutionCoordinates(session.target)
      affected.set(key, {
        userId: session.userId,
        workspaceId: coordinates.workspaceId,
        workspaceRuntimeId: coordinates.workspaceRuntimeId,
        scope: session.scope,
      })
      const closed = await this.requestSessionRetirement(session.id, 'scope')
      if (!closed && this.directory.get(session.id) === session) {
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
    for (const session of Array.from(this.directory.entries())) {
      if (session.userId !== userId) continue
      if (!session.attachments.has(clientId) && session.controllerClientId !== clientId) continue
      const previousController = this.effectiveControllerWithOverride(session, clientId, previousOnline)
      if (terminalIdentityChanged(session, previousController, this.sessionPresence(session)))
        this.emitIdentity(session)
    }
  }

  forceShutdown(): void {
    this.shuttingDown = true
    for (const retirement of this.invalidatedSessionRetirements.values()) {
      if (retirement.timer) clearTimeout(retirement.timer)
    }
    const invalidatedRetirements = Array.from(this.invalidatedSessionRetirements.values())
    this.invalidatedSessionRetirements.clear()
    for (const retirement of invalidatedRetirements) {
      try {
        retirement.session.ptyBinding.dispose(retirement.session)
      } catch (error) {
        terminalSessionManagerLogger.warn(
          { terminalRuntimeSessionId: retirement.session.id, err: error },
          'failed to dispose invalidated terminal during shutdown',
        )
      }
    }
    for (const session of Array.from(this.directory.entries())) {
      try {
        const detached = this.detachSessionAuthority(session)
        if (detached.lifecycleChanged) {
          try {
            this.emitLifecycle(session)
          } catch (error) {
            terminalSessionManagerLogger.warn(
              { terminalRuntimeSessionId: session.id, err: error },
              'failed to publish terminal shutdown lifecycle',
            )
          }
        }
        try {
          session.ptyBinding.dispose(session)
        } catch (error) {
          terminalSessionManagerLogger.warn(
            { terminalRuntimeSessionId: session.id, err: error },
            'failed to dispose terminal during shutdown',
          )
        }
        if (detached.summary) {
          try {
            this.sink.onSessionClosed?.(session.userId, detached.summary, 'shutdown')
          } catch (error) {
            terminalSessionManagerLogger.warn(
              { terminalRuntimeSessionId: session.id, err: error },
              'failed to publish terminal shutdown',
            )
          }
        } else {
          terminalSessionManagerLogger.warn(
            { terminalRuntimeSessionId: session.id },
            'skipped terminal shutdown without staged summary',
          )
        }
      } catch (error) {
        terminalSessionManagerLogger.warn(
          { terminalRuntimeSessionId: session.id, err: error },
          'failed to retire terminal',
        )
      }
    }
  }

  async listSessionsForUser(userId: TUser, scope: string): Promise<TerminalSessionSummary[]> {
    return this.directory.entriesForScope(userId, scope).map((session) => this.sessionSummary(session))
  }

  primaryTerminalSessionIdForWorktree(userId: TUser, scope: string, worktreeId: WorkspaceId): string | null {
    return this.directory.primaryForWorktree(userId, scope, worktreeId)?.terminalSessionId ?? null
  }

  terminalSessionsSnapshotForUser(userId: TUser, scope: string): TerminalSessionsSnapshot {
    const sessions = this.directory.entriesForScope(userId, scope).map((session) => this.sessionSummary(session))
    return { revision: this.projectionRevision(userId, scope), sessions }
  }

  terminalSessionsChangedEventForScope(
    userId: TUser,
    workspaceIdInput: string,
    workspaceRuntimeId: string,
  ): TerminalSessionsChangedEvent {
    const workspaceId = canonicalWorkspaceLocator(workspaceIdInput)
    if (!workspaceId) throw new Error('error.workspace-locator-malformed')
    return {
      workspaceId,
      workspaceRuntimeId,
      revision: this.projectionRevision(userId, terminalSessionRuntimeScope(workspaceId, workspaceRuntimeId)),
    }
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
    for (const session of this.directory.entries()) {
      count += 1
      const chars = session.render.buffer.length
      totalBufferChars += chars
      if (chars > maxBufferChars) maxBufferChars = chars
    }
    return { count, totalBufferChars, maxBufferChars }
  }

  private sessionSummary(session: TerminalSessionView<TUser>): TerminalSessionSummary {
    const common = {
      terminalRuntimeSessionId: session.id,
      terminalRuntimeGeneration: session.terminalRuntimeGeneration,
      terminalSessionId: session.terminalSessionId,
      controller: this.effectiveController(session),
      processName: session.ptyBinding.processName(),
      canonicalTitle: session.render.title,
      phase: session.phase,
      message: session.message,
      cols: session.cols,
      rows: session.rows,
    }
    const presentation = requiredTerminalPresentation(session)
    if (session.target.kind === 'workspace-root' && presentation.kind === 'workspace-root') {
      return { ...common, target: session.target, presentation }
    }
    if (session.target.kind === 'git-worktree' && presentation.kind === 'git-worktree') {
      return { ...common, target: session.target, presentation }
    }
    throw new Error('terminal session target and presentation disagree')
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
    // surface role, lifecycle, and geometry synchronously so the client
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

  private runtimeMetadata(
    session: TerminalSessionView<TUser>,
    controller: TerminalController | null = this.effectiveController(session),
    processName: string = session.ptyBinding.processName(),
  ): TerminalRuntimeMetadata {
    return {
      terminalRuntimeSessionId: session.id,
      terminalRuntimeGeneration: session.terminalRuntimeGeneration,
      processName,
      canonicalTitle: session.render.title,
      phase: session.phase,
      message: session.message,
      controller,
      canonicalCols: session.cols,
      canonicalRows: session.rows,
    }
  }

  private streamAttachResult(session: TerminalSessionView<TUser>): TerminalAttachResult {
    if (session.phase !== 'open') return { ok: false, message: 'error.unavailable' }
    return {
      ok: true,
      frame: 'stream',
      terminalProjectionEffect: {
        kind: 'delta',
        revision: this.projectionRevision(session.userId, session.scope),
      },
      ...this.runtimeMetadata(session),
      phase: 'open',
    }
  }

  private async snapshotAttachResult(
    session: TerminalSessionView<TUser>,
  ): Promise<Extract<TerminalAttachResult, { ok: true; frame: 'snapshot' }> | { ok: false; message: string }> {
    const generation = session.terminalRuntimeGeneration
    const snap = await replaySnapshot(session.render)
    if (!snap) return { ok: false, message: 'error.unavailable' }
    if (session.terminalRuntimeGeneration !== generation || session.ptyBinding.generation() !== generation) {
      return { ok: false, message: 'error.unavailable' }
    }
    return {
      ok: true,
      frame: 'snapshot',
      terminalProjectionEffect: { kind: 'none' },
      snapshot: snap.snapshot,
      snapshotSeq: snap.snapshotSeq,
      outputEra: snap.outputEra,
      ...this.runtimeMetadata(session),
    }
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
    workspaceId: WorkspaceId
  } {
    return {
      terminalSessionId: session.terminalSessionId,
      workspaceId: terminalExecutionCoordinates(session.target).workspaceId,
    }
  }

  private emitIdentity(session: TerminalSessionView<TUser>): void {
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

  private commitIdentityMutation(
    session: TerminalSessionView<TUser>,
    effect: ReturnType<typeof attachTerminalClient>,
  ): ReturnType<typeof attachTerminalClient> {
    if (!effect.resizeTo) return effect
    session.ptyBinding.resize(session, effect.resizeTo.cols, effect.resizeTo.rows)
    // A resize request suppresses the controller helper's immediate identity
    // effect so geometry and authority travel in one canonical event. Publish
    // that event even when the PTY rejects the resize: the controller mutation
    // still committed and the unchanged geometry is now the authoritative fact.
    return { emitIdentity: true }
  }

  private stageAdmissionController(
    session: TerminalSessionView<TUser>,
    clientId: string | undefined,
    size: { cols: number; rows: number },
  ): {
    state: TerminalControllerState
    effect: TerminalControllerEffect | null
    controller: TerminalController | null
    hadController: boolean
  } {
    const state: TerminalControllerState = {
      attachments: new Map(session.attachments),
      controllerClientId: session.controllerClientId,
      userSticky: session.userSticky,
      cols: session.cols,
      rows: session.rows,
    }
    const clientIds = new Set(state.attachments.keys())
    if (clientId) clientIds.add(clientId)
    const onlineByClientId = new Map<string, boolean>()
    for (const candidateClientId of clientIds) {
      onlineByClientId.set(candidateClientId, this.isClientOnline(session.userId, candidateClientId))
    }
    const presence = (candidateClientId: string) => onlineByClientId.get(candidateClientId) ?? false
    const hadController = effectiveTerminalController(state, presence) !== null
    let effect: TerminalControllerEffect | null = null
    if (clientId) {
      registerTerminalClient(state, clientId, size.cols, size.rows)
      effect = attachTerminalClient(state, clientId, presence)
    }
    return { state, effect, controller: effectiveTerminalController(state, presence), hadController }
  }

  private commitStagedAdmissionController(
    session: TerminalSessionView<TUser>,
    staged: { state: TerminalControllerState; effect: TerminalControllerEffect | null },
  ): TerminalControllerEffect | null {
    session.attachments = staged.state.attachments
    session.controllerClientId = staged.state.controllerClientId
    session.userSticky = staged.state.userSticky
    return staged.effect ? this.commitIdentityMutation(session, staged.effect) : null
  }

  private async restartAndAttachSession(
    session: TerminalSessionView<TUser>,
    cols: number,
    rows: number,
    signal?: AbortSignal,
  ): Promise<TerminalPtyRestartResult> {
    const spawn = await session.ptyBinding.restart(session, cols, rows, 'restarting', signal)
    return await this.finishRestartAndAttachSession(session, spawn)
  }

  private async spawnFreshSession(
    session: TerminalSessionView<TUser>,
    cols: number,
    rows: number,
    signal?: AbortSignal,
  ): Promise<{ generation: number; result: TerminalAttachResult }> {
    const spawn = await session.ptyBinding.spawn(session, cols, rows, signal)
    if (!session.ptyBinding.isCurrentSpawn(session, spawn.generation)) {
      return { generation: spawn.generation, result: { ok: false, message: 'error.unavailable' } }
    }
    if (!spawn.result.ok) {
      if (markTerminalSessionError(session, spawn.result.message)) this.emitLifecycle(session)
    } else {
      this.emitIdentity(session)
    }
    // Prepared sessions are published at generation 0. Incremental generation
    // 1 events cannot safely activate sibling clients. Publish one complete
    // projection invalidation for every current fresh-generation outcome,
    // including spawn failure, so success and error converge identically.
    this.directory.touch(session)
    this.sink.onSessionsProjectionChanged?.(session.userId, this.sessionsChangedEvent(session))
    if (!spawn.result.ok) return { generation: spawn.generation, result: spawn.result }
    return { generation: spawn.generation, result: this.streamAttachResult(session) }
  }

  private async finishRestartAndAttachSession(
    session: TerminalSessionView<TUser>,
    spawn: TerminalPtySpawnResult,
  ): Promise<TerminalPtyRestartResult> {
    if (!spawn.result.ok) return { generation: spawn.generation, result: spawn.result }
    const attach = await this.snapshotAttachResult(session)
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
        this.sink.onOutput(session.userId, { ...event, ...this.terminalSessionIdentity(session) })
      },
      emitBell: (session, event) =>
        this.sink.onBell?.(session.userId, { ...event, ...this.terminalSessionPublicScope(session) }),
      emitTitle: (session, event) => {
        this.sink.onTitle?.(session.userId, { ...event, ...this.terminalSessionPublicScope(session) })
      },
      emitExit: (session, event) =>
        this.sink.onExit(session.userId, {
          ...event,
          ...this.terminalSessionIdentity(session),
          workspaceId: terminalExecutionCoordinates(session.target).workspaceId,
          workspaceRuntimeId: terminalExecutionCoordinates(session.target).workspaceRuntimeId,
        }),
      confirmedExit: (session, terminalRuntimeGeneration) => {
        this.confirmSessionExit(session, terminalRuntimeGeneration)
      },
    })
  }

  private isLiveSession(session: TerminalSessionView<TUser>): boolean {
    return this.directory.get(session.id) === session
  }

  private isSessionAvailableForAdmission(session: TerminalSessionView<TUser>): boolean {
    return this.isLiveSession(session) && !this.isSessionClosing(session.id)
  }

  private confirmSessionExit(session: TerminalSessionView<TUser>, terminalRuntimeGeneration: number): void {
    if (this.directory.get(session.id) !== session) return
    if (session.terminalRuntimeGeneration !== terminalRuntimeGeneration) return
    const closedSession = this.detachSession(session)
    this.sink.onSessionClosed?.(session.userId, closedSession, 'session')
    session.ptyBinding.disposeAfterConfirmedExit(session)
  }

  private isSessionClosing(terminalRuntimeSessionId: string): boolean {
    return this.closeOperationsByTerminalRuntimeSessionId.has(terminalRuntimeSessionId)
  }

  private projectionRevision(userId: TUser, scope: string): number {
    return this.directory.catalogRevision(userId, scope)
  }

  private sessionsChangedEvent(session: TerminalSessionView<TUser>): TerminalSessionsChangedEvent {
    const coordinates = terminalExecutionCoordinates(session.target)
    return {
      workspaceId: coordinates.workspaceId,
      workspaceRuntimeId: coordinates.workspaceRuntimeId,
      revision: this.projectionRevision(session.userId, session.scope),
    }
  }

  private getSession(userId: TUser, terminalRuntimeSessionId: string): TerminalSessionView<TUser> | undefined {
    if (!this.isValidUserId(userId) || !isValidTerminalRuntimeSessionId(terminalRuntimeSessionId)) return undefined
    const session = this.directory.get(terminalRuntimeSessionId)
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

function sameTerminalPresentation(a: TerminalPresentation | null, b: TerminalPresentation): boolean {
  if (!a || a.kind !== b.kind) return false
  if (a.kind === 'workspace-root') return true
  if (b.kind !== 'git-worktree' || a.head.kind !== b.head.kind) return false
  return a.head.kind === 'detached' || (b.head.kind === 'branch' && a.head.branchName === b.head.branchName)
}

function assertTerminalPresentationMatchesTarget(
  target: TerminalExecutionTarget,
  presentation: TerminalPresentation,
): void {
  if (target.kind !== presentation.kind) throw new Error('error.invalid-arguments')
}

function requiredTerminalPresentation<TUser extends string | number>(
  session: TerminalSessionView<TUser>,
): TerminalPresentation {
  if (!session.presentation) throw new Error('terminal session presentation unavailable')
  return session.presentation
}

function sameTerminalScope<TUser extends string | number>(
  session: TerminalSessionView<TUser>,
  input: TerminalEnsureSessionInput<TUser>,
): boolean {
  if (
    session.scope !==
      terminalSessionRuntimeScope(
        terminalExecutionCoordinates(input.target).workspaceId,
        terminalExecutionCoordinates(input.target).workspaceRuntimeId,
      ) ||
    session.target.kind !== input.target.kind
  ) {
    return false
  }
  const current = terminalExecutionCoordinates(session.target)
  const requested = terminalExecutionCoordinates(input.target)
  return (
    current.workspaceId === requested.workspaceId &&
    current.workspaceRuntimeId === requested.workspaceRuntimeId &&
    current.worktreeId === requested.worktreeId
  )
}
