import path from 'node:path'
import {
  type TerminalAttachResult,
  type TerminalBellRealtimeEvent,
  type TerminalBoundRuntimeMetadata,
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
  type TerminalResizeResult,
  type TerminalRuntimeMetadata,
  type TerminalSessionSummary,
  type TerminalSessionsChangedEvent,
  type TerminalSessionsSnapshot,
  type TerminalTakeoverResult,
  type TerminalTitleEvent,
  type TerminalWriteResult,
} from '#/shared/terminal-types.ts'
import {
  isValidTerminalRuntimeSessionId,
  isValidTerminalWriteData,
  normalizeTerminalSize,
} from '#/shared/terminal-validators.ts'
import { createOpaqueId } from '#/shared/opaque-id.ts'
import {
  claimTerminalClientControl,
  commitTerminalClientAttachment,
  decideTerminalClientAttachment,
  effectiveTerminalController,
  expireTerminalClient,
  explainAuthority,
  isAuthoritative,
  prepareTerminalClientAdmission,
  terminalIdentityChanged,
  type TerminalAuthorityReason,
} from '#/server/terminal/terminal-controller.ts'
import { markTerminalSessionClosed, markTerminalSessionError } from '#/server/terminal/terminal-session-lifecycle.ts'
import {
  advanceTerminalPtyIdentityRevision,
  TerminalPtyBinding,
  terminalPtyBoundState,
  terminalPtyGeneration,
  terminalPtyIdentityRevision,
  terminalPtyProcessName,
  type TerminalPtyBindingAdmission,
  type TerminalPtyBoundState,
  type TerminalPtyMutationAdmission,
  type TerminalPtyRecoverySnapshot,
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
import type { TerminalSessionCloseOutcome } from '#/server/terminal/terminal-session-close.ts'

type TerminalSessionRetirementOutcome = 'detached' | 'already-detached' | 'failed'
const terminalSessionManagerLogger = serverLogger.child({ module: 'terminal-session-manager' })

export type TerminalSessionCloseReason = 'session' | 'workspace-pane' | 'scope' | 'detached-user' | 'shutdown'

interface TerminalPtyRestartResult {
  attempt: number
  generation: number
  result: TerminalRestartResult
}

export type TerminalSessionPrepareResult =
  { ok: true; terminalRuntimeSessionId: string; admission: TerminalSessionAdmission } | { ok: false; message: string }

export interface TerminalEnsureSessionInput<TUser extends string | number> {
  userId: TUser
  terminalSessionId: string
  physicalWorktreeCapability: PhysicalWorktreeExecutionCapability
  cwd: string
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
  readonly executionRootId: WorkspaceId
  target: TerminalExecutionTarget
  physicalWorktreeCapability: PhysicalWorktreeExecutionCapability
  ptyBinding: TerminalPtyBinding<TerminalSessionView<TUser>>
  attachments: Set<string>
  controllerClientId: string | null
  workspaceRuntimeRetention: { release(): void } | null
}

export interface TerminalEventSink<TUser extends string | number> {
  onOutput(userId: TUser, event: TerminalOutputEvent): void
  onBell?(userId: TUser, event: TerminalBellRealtimeEvent): void
  onTitle?(userId: TUser, event: TerminalTitleEvent): void
  onExit(userId: TUser, event: TerminalExitEvent): void
  onSessionClosed?(
    userId: TUser,
    session: TerminalSessionSummary,
    reason: TerminalSessionCloseReason,
  ): void | Promise<void>
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

export interface TerminalWorkspaceRuntimeRetentionHost<TUser extends string | number> {
  retain(
    userId: TUser,
    workspaceId: WorkspaceId,
    workspaceRuntimeId: string,
    terminalRuntimeSessionId: string,
  ): { release(): void }
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
  private readonly closeOperationsByTerminalRuntimeSessionId = new Map<
    string,
    Promise<TerminalSessionRetirementOutcome>
  >()
  // Scope invalidation removes addressability and render ownership
  // synchronously. Only the native PTY retirement completion survives here
  // until exit is confirmed or forceShutdown transfers observation to the
  // supervisor shutdown boundary.
  private readonly invalidatedSessionResourceRetirements = new Map<string, Promise<void>>()
  private readonly sink: TerminalEventSink<TUser>
  private readonly ptySupervisor: PtySupervisor
  private readonly isClientOnline: (userId: TUser, clientId: string) => boolean
  private readonly workspaceRuntimeRetentions: TerminalWorkspaceRuntimeRetentionHost<TUser>

  constructor(
    ptySupervisor: PtySupervisor,
    sink: TerminalEventSink<TUser>,
    isClientOnline: (userId: TUser, clientId: string) => boolean,
    workspaceRuntimeRetentions: TerminalWorkspaceRuntimeRetentionHost<TUser>,
  ) {
    this.ptySupervisor = ptySupervisor
    this.sink = sink
    this.isClientOnline = isClientOnline
    this.workspaceRuntimeRetentions = workspaceRuntimeRetentions
  }

  prepareSession(input: TerminalEnsureSessionInput<TUser>): TerminalSessionPrepareResult {
    if (input.signal?.aborted) return { ok: false, message: 'error.workspace-runtime-stale' }
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
            const controller = this.effectiveController(existing)
            const processName = terminalPtyProcessName(existing)
            const action: TerminalCreateAction = controller ? 'restored' : 'reused'
            presentationChanged = !sameTerminalPresentation(existing.presentation, presentation)
            const commitSessionMutation = () => {
              existing.presentation = presentation
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
              ...this.runtimeMetadata(existing, controller, processName),
            }
          },
          publishCommittedEffects: () => {
            if (admissionState !== 'committed' || effectsPublished) return
            effectsPublished = true
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
      executionRootId: coordinates.executionRootId,
      target: input.target,
      physicalWorktreeCapability: input.physicalWorktreeCapability,
      cwd,
      command: input.command,
      args: input.args,
      startupShellCommand: input.startupShellCommand,
      env: input.env,
      ptyState: { kind: 'prepared' },
      ptyBinding: this.createPtyBinding(),
      attachments: new Set(),
      controllerClientId: null,
      phase: 'opening',
      message: null,
      workspaceRuntimeRetention: null,
    }
    const reservation = this.directory.reserve({
      id,
      userId,
      scope,
      terminalSessionId: input.terminalSessionId,
      executionRootId: coordinates.executionRootId,
    })
    if (!reservation) return { ok: false, message: 'error.unavailable' }
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
        const processName = terminalPtyProcessName(session)
        session.presentation = presentation
        const retention = this.workspaceRuntimeRetentions.retain(
          session.userId,
          coordinates.workspaceId,
          coordinates.workspaceRuntimeId,
          session.id,
        )
        try {
          reservation.commit(session)
          session.workspaceRuntimeRetention = retention
        } catch (error) {
          retention.release()
          throw error
        }
        admissionState = 'committed'
        return {
          action: 'created',
          presentation,
          terminalProjectionEffect: { kind: 'delta', revision: this.projectionRevision(userId, scope) },
          ...this.runtimeMetadata(session, null, processName),
        }
      },
      publishCommittedEffects: () => {
        if (admissionState !== 'committed' || effectsPublished) return
        effectsPublished = true
        this.sink.onSessionsProjectionChanged?.(session.userId, this.sessionsChangedEvent(session))
      },
      abort: () => {
        if (admissionState !== 'pending') return
        admissionState = 'aborted'
        reservation.abort()
        session.ptyBinding.revokeOwnership(session)
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
    terminalRuntimeGeneration: number,
    data: string,
    clientId: string,
  ): Promise<TerminalWriteResult> {
    if (!isValidTerminalRuntimeSessionId(terminalRuntimeSessionId) || !isValidTerminalWriteData(data)) {
      return { status: 'rejected' }
    }
    const session = this.getSession(userId, terminalRuntimeSessionId)
    if (!session || terminalPtyGeneration(session) !== terminalRuntimeGeneration) return { status: 'rejected' }
    if (this.isSessionClosing(terminalRuntimeSessionId)) return { status: 'rejected' }
    if (terminalPtyBoundState(session)?.activity !== 'active') return { status: 'rejected' }
    if (session.phase !== 'open') return { status: 'rejected' }
    if (!isAuthoritative(session, clientId, this.sessionPresence(session))) return { status: 'rejected' }
    return await session.ptyBinding.write(session, data)
  }

  async attachSession(
    userId: TUser,
    terminalRuntimeSessionId: string,
    terminalRuntimeGeneration: number,
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
    if (terminalPtyGeneration(session) !== terminalRuntimeGeneration) return { ok: false, message: 'error.unavailable' }
    if (this.isSessionClosing(terminalRuntimeSessionId)) return { ok: false, message: 'error.unavailable' }
    const joinedPreparedSpawn = terminalRuntimeGeneration === 0 && session.ptyState.kind === 'prepared'
    if (session.ptyBinding.hasPendingSpawn()) {
      const pending = await session.ptyBinding.waitForPendingSpawn(session)
      if (pending && !pending.ok) return pending
    }
    if (!this.isLiveSession(session)) return { ok: false, message: 'error.unavailable' }
    if (signal?.aborted) return { ok: false, message: 'error.workspace-runtime-stale' }

    const bound = terminalPtyBoundState(session)
    if (bound) {
      if (bound.generation !== terminalRuntimeGeneration && !(joinedPreparedSpawn && bound.generation === 1)) {
        return { ok: false, message: 'error.unavailable' }
      }
      if (decideTerminalClientAttachment(session, clientId, this.sessionPresence(session)) === 'unavailable') {
        return { ok: false, message: 'error.unavailable' }
      }
      let attachmentDecision: 'controller' | 'viewer' | null = null
      let committedMetadata: TerminalBoundRuntimeMetadata | null = null
      let controllerChanged = false
      const recovery = await session.ptyBinding.recoveryAttach(session, bound.generation, size.cols, size.rows, {
        prepare: () => {
          if (!this.isSessionAvailableForAdmission(session)) return null
          const current = terminalPtyBoundState(session)
          if (!current || current.generation !== bound.generation) return null
          const decision = decideTerminalClientAttachment(session, clientId, this.sessionPresence(session))
          if (decision === 'unavailable') return null
          attachmentDecision = decision
          return decision === 'controller' && current.activity === 'active' ? 'resize' : 'preserve'
        },
        commit: () => {
          if (!this.isSessionAvailableForAdmission(session) || attachmentDecision === null) return false
          const current = terminalPtyBoundState(session)
          if (!current || current.generation !== bound.generation) return false
          if (decideTerminalClientAttachment(session, clientId, this.sessionPresence(session)) !== attachmentDecision) {
            return false
          }
          const previousController = this.effectiveController(session)
          commitTerminalClientAttachment(session, clientId, attachmentDecision)
          controllerChanged = terminalIdentityChanged(session, previousController, this.sessionPresence(session))
          if (controllerChanged) advanceTerminalPtyIdentityRevision(session, current.generation)
          committedMetadata = this.boundRuntimeMetadata(session, { cols: current.cols, rows: current.rows })
          return committedMetadata !== null
        },
      })
      if (recovery.changed || controllerChanged) this.emitIdentity(session)
      if (!recovery.accepted || !recovery.snapshot || !committedMetadata) {
        return { ok: false, message: 'error.unavailable' }
      }
      return this.snapshotAttachResult(recovery.snapshot, committedMetadata)
    }

    if (terminalRuntimeGeneration !== 0 || session.ptyState.kind !== 'prepared') {
      return { ok: false, message: 'error.unavailable' }
    }
    const decision = decideTerminalClientAttachment(session, clientId, this.sessionPresence(session))
    if (decision === 'unavailable') return { ok: false, message: 'error.unavailable' }
    const admission = prepareTerminalClientAdmission(
      session,
      clientId,
      decision,
      this.sessionPresence(session),
      () => this.isSessionAvailableForAdmission(session) && session.ptyState.kind === 'prepared',
    )
    const spawn = await this.spawnFreshSession(session, size.cols, size.rows, admission, signal)
    return spawn.result
  }

  async resizeSession(
    userId: TUser,
    terminalRuntimeSessionId: string,
    terminalRuntimeGeneration: number,
    cols: number,
    rows: number,
    clientId: string,
  ): Promise<TerminalResizeResult> {
    if (!isValidTerminalRuntimeSessionId(terminalRuntimeSessionId)) {
      return { ok: false, message: 'error.invalid-arguments' }
    }
    const size = normalizeTerminalSize(cols, rows)
    if (!size) return { ok: false, message: 'error.invalid-arguments' }
    const session = this.getSession(userId, terminalRuntimeSessionId)
    if (!session) return { ok: false, message: 'error.invalid-arguments' }
    if (this.isSessionClosing(terminalRuntimeSessionId)) return { ok: false, message: 'error.unavailable' }
    const bound = terminalPtyBoundState(session)
    if (!bound || bound.generation !== terminalRuntimeGeneration || bound.activity !== 'active') {
      return { ok: false, message: 'error.unavailable' }
    }
    if (session.phase !== 'open') return { ok: false, message: 'error.unavailable' }
    if (!isAuthoritative(session, clientId, this.sessionPresence(session))) {
      return { ok: false, message: 'error.unavailable' }
    }
    let committedResult: Extract<TerminalResizeResult, { ok: true }> | null = null
    const geometry = await this.resizeSessionPty(session, terminalRuntimeGeneration, size.cols, size.rows, {
      validate: () =>
        this.isSessionAvailableForAdmission(session) &&
        terminalPtyGeneration(session) === terminalRuntimeGeneration &&
        session.phase === 'open' &&
        isAuthoritative(session, clientId, this.sessionPresence(session)),
      commit: () => {
        if (
          !this.isSessionAvailableForAdmission(session) ||
          terminalPtyGeneration(session) !== terminalRuntimeGeneration ||
          session.phase !== 'open' ||
          !isAuthoritative(session, clientId, this.sessionPresence(session))
        ) {
          return false
        }
        const current = terminalPtyBoundState(session)
        if (!current || current.generation !== terminalRuntimeGeneration || current.activity !== 'active') return false
        committedResult = {
          ok: true,
          terminalRuntimeSessionId: session.id,
          terminalRuntimeGeneration: current.generation,
          identityRevision: terminalPtyIdentityRevision(session),
          role: 'controller',
          controllerStatus: 'connected',
          controller: this.effectiveController(session),
          canonicalSize: { cols: current.cols, rows: current.rows },
        }
        return true
      },
    })
    if (geometry.changed) this.emitIdentity(session)
    if (!geometry.accepted || !committedResult) {
      return { ok: false, message: 'error.unavailable' }
    }
    return committedResult
  }

  async takeoverSession(
    userId: TUser,
    terminalRuntimeSessionId: string,
    terminalRuntimeGeneration: number,
    cols: number,
    rows: number,
    clientId: string,
  ): Promise<TerminalTakeoverResult> {
    if (!isValidTerminalRuntimeSessionId(terminalRuntimeSessionId))
      return { ok: false, message: 'error.invalid-arguments' }
    const size = normalizeTerminalSize(cols, rows)
    if (!size) return { ok: false, message: 'error.invalid-arguments' }
    const session = this.getSession(userId, terminalRuntimeSessionId)
    if (!session) return { ok: false, message: 'error.invalid-arguments' }
    if (this.isSessionClosing(terminalRuntimeSessionId)) return { ok: false, message: 'error.unavailable' }
    const bound = terminalPtyBoundState(session)
    if (!bound || bound.generation !== terminalRuntimeGeneration || bound.activity !== 'active') {
      return { ok: false, message: 'error.unavailable' }
    }
    if (session.phase !== 'open') return { ok: false, message: 'error.unavailable' }
    const presence = this.sessionPresence(session)
    if (!presence(clientId)) {
      return { ok: false, message: 'error.invalid-arguments' }
    }
    let committedResult: Extract<TerminalTakeoverResult, { ok: true }> | null = null
    let controllerChanged = false
    const geometry = await this.resizeSessionPty(session, terminalRuntimeGeneration, size.cols, size.rows, {
      validate: () =>
        this.isSessionAvailableForAdmission(session) &&
        terminalPtyGeneration(session) === terminalRuntimeGeneration &&
        session.phase === 'open' &&
        presence(clientId),
      commit: () => {
        if (
          !this.isSessionAvailableForAdmission(session) ||
          terminalPtyGeneration(session) !== terminalRuntimeGeneration ||
          session.phase !== 'open' ||
          !presence(clientId)
        ) {
          return false
        }
        const previousController = this.effectiveController(session)
        if (!claimTerminalClientControl(session, clientId, presence)) return false
        controllerChanged = terminalIdentityChanged(session, previousController, presence)
        if (controllerChanged) advanceTerminalPtyIdentityRevision(session, terminalRuntimeGeneration)
        const result = this.takeoverResult(session)
        if (!result.ok) throw new Error('committed terminal takeover lost its runtime binding')
        committedResult = result
        return true
      },
    })
    if (geometry.changed || controllerChanged) this.emitIdentity(session)
    if (!geometry.accepted || !committedResult) {
      return { ok: false, message: 'error.unavailable' }
    }
    return committedResult
  }

  async restartSession(
    userId: TUser,
    terminalRuntimeSessionId: string,
    terminalRuntimeGeneration: number,
    cols: number,
    rows: number,
    clientId: string,
    signal?: AbortSignal,
  ): Promise<TerminalRestartResult> {
    return (
      await this.restartSessionWithProjectionOutcome(
        userId,
        terminalRuntimeSessionId,
        terminalRuntimeGeneration,
        cols,
        rows,
        clientId,
        signal,
      )
    ).result
  }

  async restartSessionWithProjectionOutcome(
    userId: TUser,
    terminalRuntimeSessionId: string,
    terminalRuntimeGeneration: number,
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
    const bound = terminalPtyBoundState(session)
    if (!bound || bound.generation !== terminalRuntimeGeneration) {
      return { result: { ok: false, message: 'error.unavailable' }, projectionChanged: null }
    }
    const denyReason = explainAuthority(session, clientId, this.sessionPresence(session))
    if (denyReason !== null) {
      return { result: { ok: false, message: authorityReasonToMessage(denyReason) }, projectionChanged: null }
    }
    if (signal?.aborted)
      return { result: { ok: false, message: 'error.workspace-runtime-stale' }, projectionChanged: null }
    const restartAdmission: TerminalPtyBindingAdmission = {
      commit: () => {
        const current = terminalPtyBoundState(session)
        if (
          !this.isSessionAvailableForAdmission(session) ||
          !current ||
          current.generation !== terminalRuntimeGeneration ||
          explainAuthority(session, clientId, this.sessionPresence(session)) !== null
        ) {
          throw new Error('error.unavailable')
        }
      },
      rollback: () => {},
    }
    const spawn = await this.restartAndAttachSession(session, size.cols, size.rows, restartAdmission, signal)
    if (!spawn.result.ok && session.ptyBinding.isCurrentSpawn(session, spawn.attempt)) {
      if (markTerminalSessionError(session, spawn.result.message)) this.emitLifecycle(session)
    }
    let projectionChanged: TerminalSessionsChangedEvent | null = null
    if (this.isSessionAvailableForAdmission(session) && session.ptyBinding.isCurrentSpawn(session, spawn.attempt)) {
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

  async closeSessionForUserOutcome(
    userId: TUser,
    terminalRuntimeSessionId: string,
    reason: TerminalSessionCloseReason = 'session',
  ): Promise<TerminalSessionCloseOutcome> {
    const session = this.getSession(userId, terminalRuntimeSessionId)
    if (!session) return { kind: 'already-closed' }
    const summary = this.sessionSummary(session)
    const retirement = await this.requestSessionRetirementOutcome(terminalRuntimeSessionId, reason)
    if (retirement.admission === 'initiated' && retirement.outcome === 'detached') {
      return { kind: 'closed', session: summary }
    }
    if (retirement.outcome !== 'failed' || this.directory.get(terminalRuntimeSessionId) !== session) {
      return { kind: 'already-closed' }
    }
    return { kind: 'failed' }
  }

  async requestSessionRetirement(
    terminalRuntimeSessionId: string,
    reason: TerminalSessionCloseReason = 'session',
  ): Promise<boolean> {
    const retirement = await this.requestSessionRetirementOutcome(terminalRuntimeSessionId, reason)
    return retirement.admission !== 'absent' && retirement.outcome !== 'failed'
  }

  private async requestSessionRetirementOutcome(
    terminalRuntimeSessionId: string,
    reason: TerminalSessionCloseReason = 'session',
  ): Promise<{
    admission: 'initiated' | 'joined' | 'absent'
    outcome: TerminalSessionRetirementOutcome
  }> {
    const existing = this.closeOperationsByTerminalRuntimeSessionId.get(terminalRuntimeSessionId)
    if (existing) return { admission: 'joined', outcome: await existing }
    const session = this.directory.get(terminalRuntimeSessionId)
    if (!session) return { admission: 'absent', outcome: 'already-detached' }
    // Publish the single-flight operation before disposal can synchronously
    // deliver PTY exit and re-enter closeSession through the lifecycle sink.
    const operation = Promise.resolve().then(async () => await this.closeSessionAndWait(session, reason))
    this.closeOperationsByTerminalRuntimeSessionId.set(terminalRuntimeSessionId, operation)
    try {
      return { admission: 'initiated', outcome: await operation }
    } finally {
      if (this.closeOperationsByTerminalRuntimeSessionId.get(terminalRuntimeSessionId) === operation) {
        this.closeOperationsByTerminalRuntimeSessionId.delete(terminalRuntimeSessionId)
      }
    }
  }

  private async closeSessionAndWait(
    session: TerminalSessionView<TUser>,
    reason: TerminalSessionCloseReason,
  ): Promise<TerminalSessionRetirementOutcome> {
    session.ptyBinding.revokeOwnership(session)
    try {
      await session.ptyBinding.disposeAndWait(session)
    } catch (error) {
      if (this.directory.get(session.id) !== session) return 'already-detached'
      if (markTerminalSessionError(session, error instanceof Error ? error.message : String(error))) {
        this.emitLifecycle(session)
      }
      return 'failed'
    }
    if (this.directory.get(session.id) !== session) return 'already-detached'
    this.detachSessionWithEffects(session, reason)
    return 'detached'
  }

  private detachSessionWithEffects(session: TerminalSessionView<TUser>, reason: TerminalSessionCloseReason): void {
    const closeEffectsRetention = reason === 'session' ? this.takeWorkspaceRuntimeRetention(session) : null
    let detached: { summary: TerminalSessionSummary | null; lifecycleChanged: boolean }
    try {
      detached = this.detachSessionAuthority(session)
    } catch (error) {
      closeEffectsRetention?.release()
      throw error
    }
    this.publishDetachedSessionEffects(session, detached, reason, closeEffectsRetention)
  }

  private detachSessionAuthority(session: TerminalSessionView<TUser>): {
    summary: TerminalSessionSummary | null
    lifecycleChanged: boolean
  } {
    session.ptyBinding.revokeOwnership(session)
    const lifecycleChanged = markTerminalSessionClosed(session)
    let summary: TerminalSessionSummary | null = null
    try {
      summary = this.sessionSummary(session)
    } catch (error) {
      terminalSessionManagerLogger.warn(
        { terminalRuntimeSessionId: session.id, err: error },
        'failed to stage invalidated terminal session summary',
      )
    }
    this.directory.remove(session)
    this.releaseWorkspaceRuntimeRetention(session)
    return { summary, lifecycleChanged }
  }

  private publishDetachedSessionEffects(
    session: TerminalSessionView<TUser>,
    detached: { summary: TerminalSessionSummary | null; lifecycleChanged: boolean },
    reason: TerminalSessionCloseReason,
    closeEffectsRetention: { release(): void } | null = null,
  ): void {
    if (detached.lifecycleChanged) {
      try {
        this.emitLifecycle(session)
      } catch (error) {
        terminalSessionManagerLogger.warn(
          { terminalRuntimeSessionId: session.id, err: error },
          'failed to publish detached terminal lifecycle',
        )
      }
    }
    if (!detached.summary) {
      try {
        terminalSessionManagerLogger.warn(
          { terminalRuntimeSessionId: session.id },
          'skipped detached terminal close without staged summary',
        )
      } finally {
        closeEffectsRetention?.release()
      }
      return
    }
    let closeEffect: void | Promise<void>
    try {
      closeEffect = this.sink.onSessionClosed?.(session.userId, detached.summary, reason)
    } catch (error) {
      try {
        terminalSessionManagerLogger.warn(
          { terminalRuntimeSessionId: session.id, err: error },
          'failed to publish detached terminal close',
        )
      } finally {
        closeEffectsRetention?.release()
      }
      return
    }
    if (!closeEffect) {
      closeEffectsRetention?.release()
      return
    }
    void closeEffect.then(
      () => closeEffectsRetention?.release(),
      (error: unknown) => {
        try {
          terminalSessionManagerLogger.warn(
            { terminalRuntimeSessionId: session.id, err: error },
            'failed to publish detached terminal close',
          )
        } finally {
          closeEffectsRetention?.release()
        }
      },
    )
  }

  private releaseWorkspaceRuntimeRetention(session: TerminalSessionView<TUser>): void {
    const retention = session.workspaceRuntimeRetention
    if (!retention) return
    session.workspaceRuntimeRetention = null
    retention.release()
  }

  private takeWorkspaceRuntimeRetention(session: TerminalSessionView<TUser>): { release(): void } {
    const retention = session.workspaceRuntimeRetention
    if (!retention) throw new Error('terminal session lost its workspace runtime retention')
    session.workspaceRuntimeRetention = null
    return retention
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
      this.adoptInvalidatedSessionResourceRetirement(session)
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
          this.publishDetachedSessionEffects(session, { summary, lifecycleChanged }, 'scope')
        }
      },
    }
  }

  private adoptInvalidatedSessionResourceRetirement(session: TerminalSessionView<TUser>): void {
    const terminalRuntimeSessionId = session.id
    if (this.invalidatedSessionResourceRetirements.has(terminalRuntimeSessionId)) return
    const operation = session.ptyBinding.disposeDetachedAndWait(session)
    this.invalidatedSessionResourceRetirements.set(terminalRuntimeSessionId, operation)
    void operation.then(
      () => {
        if (this.invalidatedSessionResourceRetirements.get(terminalRuntimeSessionId) === operation) {
          this.invalidatedSessionResourceRetirements.delete(terminalRuntimeSessionId)
        }
      },
      (error: unknown) => {
        if (this.invalidatedSessionResourceRetirements.get(terminalRuntimeSessionId) !== operation) return
        terminalSessionManagerLogger.warn(
          { terminalRuntimeSessionId, err: error },
          'retaining failed invalidated terminal resource retirement until shutdown',
        )
      },
    )
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
      if (terminalIdentityChanged(session, previousController, this.sessionPresence(session))) {
        advanceTerminalPtyIdentityRevision(session, terminalPtyGeneration(session))
        this.emitIdentity(session)
      }
    }
  }

  expireClientAttachments(userId: TUser, clientId: string): void {
    for (const session of Array.from(this.directory.entries())) {
      if (session.userId !== userId) continue
      const previousController = this.effectiveController(session)
      if (!expireTerminalClient(session, clientId)) continue
      if (terminalIdentityChanged(session, previousController, this.sessionPresence(session))) {
        advanceTerminalPtyIdentityRevision(session, terminalPtyGeneration(session))
        this.emitIdentity(session)
      }
    }
  }

  forceShutdown(): void {
    // Detached bindings already revoked their listeners and transferred native
    // exit observation to the supervisor. Runtime shutdown invokes supervisor
    // shutdown immediately after this method, which completes those durable
    // exit capabilities without a second kill attempt here.
    this.invalidatedSessionResourceRetirements.clear()
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

  primaryTerminalSessionIdForFilesystemTarget(
    userId: TUser,
    scope: string,
    executionRootId: WorkspaceId,
  ): string | null {
    return this.directory.primaryForFilesystemTarget(userId, scope, executionRootId)?.terminalSessionId ?? null
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

  getSessionCount(): number {
    return Array.from(this.directory.entries()).length
  }

  private sessionSummary(session: TerminalSessionView<TUser>): TerminalSessionSummary {
    const bound = terminalPtyBoundState(session)
    const common = {
      terminalRuntimeSessionId: session.id,
      terminalRuntimeGeneration: terminalPtyGeneration(session),
      identityRevision: terminalPtyIdentityRevision(session),
      terminalSessionId: session.terminalSessionId,
      controller: this.effectiveController(session),
      processName: terminalPtyProcessName(session),
      canonicalTitle: bound?.render.title ?? null,
      phase: session.phase,
      message: session.message,
      canonicalSize: bound ? { cols: bound.cols, rows: bound.rows } : null,
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
  private async resizeSessionPty(
    session: TerminalSessionView<TUser>,
    terminalRuntimeGeneration: number,
    cols: number,
    rows: number,
    admission: TerminalPtyMutationAdmission,
  ): Promise<{ accepted: boolean; changed: boolean }> {
    return await session.ptyBinding.resize(session, terminalRuntimeGeneration, cols, rows, admission)
  }

  private takeoverResult(session: TerminalSessionView<TUser>): TerminalTakeoverResult {
    const bound = terminalPtyBoundState(session)
    if (!bound) return { ok: false, message: 'error.unavailable' }
    return {
      ok: true,
      terminalRuntimeSessionId: session.id,
      terminalRuntimeGeneration: bound.generation,
      identityRevision: terminalPtyIdentityRevision(session),
      role: 'controller',
      controllerStatus: 'connected',
      controller: this.effectiveController(session),
      canonicalSize: { cols: bound.cols, rows: bound.rows },
      phase: session.phase,
    }
  }

  private runtimeMetadata(
    session: TerminalSessionView<TUser>,
    controller: TerminalController | null = this.effectiveController(session),
    processName: string = terminalPtyProcessName(session),
  ): TerminalRuntimeMetadata {
    const bound = terminalPtyBoundState(session)
    return {
      terminalRuntimeSessionId: session.id,
      terminalRuntimeGeneration: terminalPtyGeneration(session),
      identityRevision: terminalPtyIdentityRevision(session),
      processName,
      canonicalTitle: bound?.render.title ?? null,
      phase: session.phase,
      message: session.message,
      controller,
      canonicalSize: bound ? { cols: bound.cols, rows: bound.rows } : null,
    }
  }

  private streamAttachResult(
    session: TerminalSessionView<TUser>,
  ): Extract<TerminalAttachResult, { ok: true; frame: 'stream' }> | { ok: false; message: string } {
    const metadata = this.boundRuntimeMetadata(session)
    if (!metadata || session.phase !== 'open') return { ok: false, message: 'error.unavailable' }
    return {
      ok: true,
      frame: 'stream',
      terminalProjectionEffect: {
        kind: 'delta',
        revision: this.projectionRevision(session.userId, session.scope),
      },
      ...metadata,
      phase: 'open',
    }
  }

  private snapshotAttachResult(
    snap: TerminalPtyRecoverySnapshot,
    metadata: TerminalBoundRuntimeMetadata,
  ): Extract<TerminalAttachResult, { ok: true; frame: 'snapshot' }> {
    return {
      ok: true,
      frame: 'snapshot',
      terminalProjectionEffect: { kind: 'none' },
      snapshot: snap.snapshot,
      snapshotSeq: snap.snapshotSeq,
      ...metadata,
    }
  }

  private boundRuntimeMetadata(
    session: TerminalSessionView<TUser>,
    canonicalSize?: { cols: number; rows: number },
  ): (TerminalRuntimeMetadata & { canonicalSize: { cols: number; rows: number } }) | null {
    const metadata = this.runtimeMetadata(session)
    const size = canonicalSize ?? metadata.canonicalSize
    return size ? { ...metadata, canonicalSize: size } : null
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
    const bound = terminalPtyBoundState(session)
    if (!bound) return
    this.sink.onIdentity?.(session.userId, {
      terminalRuntimeSessionId: session.id,
      terminalRuntimeGeneration: bound.generation,
      identityRevision: bound.identityRevision,
      ...this.terminalSessionIdentity(session),
      controller: this.effectiveController(session),
      canonicalSize: { cols: bound.cols, rows: bound.rows },
    })
  }

  // Lifecycle emits a single, identity-free event whenever the session's phase
  // or message changes. A
  // controller→viewer teardown decision in the client must not
  // subscribe to this channel; the wire keeps the two concerns on
  // separate paths so the type-level separation in the client
  // (`applyIdentity` vs `applyLifecycle`) cannot be circumvented.
  private emitLifecycle(session: TerminalSessionView<TUser>): void {
    this.sink.onLifecycle?.(session.userId, {
      terminalRuntimeSessionId: session.id,
      terminalRuntimeGeneration: terminalPtyGeneration(session),
      ...this.terminalSessionIdentity(session),
      phase: session.phase,
      message: session.message,
    })
  }

  private async restartAndAttachSession(
    session: TerminalSessionView<TUser>,
    cols: number,
    rows: number,
    admission: TerminalPtyBindingAdmission,
    signal?: AbortSignal,
  ): Promise<TerminalPtyRestartResult> {
    const spawn = await session.ptyBinding.restart(session, cols, rows, admission, signal)
    return await this.finishRestartAndAttachSession(session, spawn)
  }

  private async spawnFreshSession(
    session: TerminalSessionView<TUser>,
    cols: number,
    rows: number,
    admission: TerminalPtyBindingAdmission,
    signal?: AbortSignal,
  ): Promise<{ generation: number; result: TerminalAttachResult }> {
    const spawn = await session.ptyBinding.spawn(session, cols, rows, admission, signal)
    if (!session.ptyBinding.isCurrentSpawn(session, spawn.attempt)) {
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
    if (!spawn.result.ok) return { attempt: spawn.attempt, generation: spawn.generation, result: spawn.result }
    if (!session.ptyBinding.isCurrentSpawn(session, spawn.attempt)) {
      return {
        attempt: spawn.attempt,
        generation: spawn.generation,
        result: { ok: false, message: 'error.unavailable' },
      }
    }
    this.emitIdentity(session)
    return { attempt: spawn.attempt, generation: spawn.generation, result: this.streamAttachResult(session) }
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
    if (terminalPtyGeneration(session) !== terminalRuntimeGeneration) return
    try {
      this.detachSessionWithEffects(session, 'session')
    } finally {
      session.ptyBinding.disposeAfterConfirmedExit(session)
    }
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

// Map the shared authority-rejection reasons to user-visible error
// keys. Lives next to the manager because the keys are the wire
// protocol's; the decision function itself stays string-free so it
// can be reused for non-IPC paths (e.g. internal supervisor logic).
function authorityReasonToMessage(reason: TerminalAuthorityReason): string {
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
    current.executionRootId === requested.executionRootId
  )
}
