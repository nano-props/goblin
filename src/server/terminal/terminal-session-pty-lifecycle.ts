import {
  type TerminalExitEvent,
  type TerminalBellRealtimeEvent,
  type TerminalOutputEvent,
  type TerminalSessionPhase,
  type TerminalTitleEvent,
  type TerminalWriteResult,
} from '#/shared/terminal-types.ts'
import { isShellProcessName } from '#/shared/terminal-process-name.ts'
import { serverLogger } from '#/server/logger.ts'
import {
  appendOutput,
  applyTerminalTitle,
  createEmptyTerminalRenderState,
  disposeRender,
  replaySnapshot,
  resizeRender,
  type RenderSnapshot,
  type TerminalRenderState,
} from '#/server/terminal/terminal-render-state.ts'
import {
  markTerminalSessionOpen,
  markTerminalSessionOpening,
  markTerminalSessionRestarting,
} from '#/server/terminal/terminal-session-lifecycle.ts'
import type {
  PtyEventLease,
  PtyHandle,
  PtySpawnInput,
  PtySpawnResult,
  PtySupervisor,
} from '#/server/terminal/pty-supervisor.ts'

const ptyLifecycleLogger = serverLogger.child({ module: 'terminal-session-pty-lifecycle' })

type TerminalPtySpawnOutcome = { ok: true } | { ok: false; message: string }

interface PendingSpawnOwnership {
  completion: Promise<void>
  failed: boolean
  failure: unknown
  releaseConsumer(): void
}

interface AbortablePtySpawn {
  result: Promise<PtySpawnResult>
  ownership: Promise<void>
}

interface RetiringPtyOwnership {
  handle: PtyHandle
  attempt: Promise<void> | null
  exited: Promise<void>
}

interface PendingInputWrite {
  data: string
  resolve(result: TerminalWriteResult): void
}

interface InFlightInputBatch {
  writes: PendingInputWrite[]
  settled: boolean
}

export interface TerminalPtyBindingAdmission {
  commit(): void
  rollback(): void
}

export interface TerminalPtySpawnResult {
  attempt: number
  generation: number
  result: TerminalPtySpawnOutcome
}

export interface TerminalPtyResizeResult {
  accepted: boolean
  changed: boolean
}

export interface TerminalPtyMutationAdmission {
  validate(): boolean
  commit(): boolean
}

export type TerminalPtyRecoveryGeometry = 'resize' | 'preserve'

export interface TerminalPtyRecoveryAdmission {
  prepare(): TerminalPtyRecoveryGeometry | null
  commit(): boolean
}

export interface TerminalPtyRecoveryAttachResult extends TerminalPtyResizeResult {
  snapshot: TerminalPtyRecoverySnapshot | null
}

export interface TerminalPtyRecoverySnapshot extends RenderSnapshot {
  generation: number
  canonicalSize: { cols: number; rows: number }
}

export interface TerminalPtySessionState<TUser extends string | number = string | number> {
  id: string
  userId: TUser
  cwd: string
  command?: string
  args?: string[]
  startupShellCommand?: string
  env?: Record<string, string>
  phase: TerminalSessionPhase
  message: string | null
  ptyState: TerminalPtyState
}

export type TerminalPtyState =
  | { kind: 'prepared' }
  | {
      kind: 'bound'
      activity: 'active' | 'retained'
      generation: number
      cols: number
      rows: number
      processName: string
      render: TerminalRenderState
    }

export type TerminalPtyBoundState = Extract<TerminalPtyState, { kind: 'bound' }>

export function terminalPtyGeneration(session: Pick<TerminalPtySessionState, 'ptyState'>): number {
  return session.ptyState.kind === 'bound' ? session.ptyState.generation : 0
}

export function terminalPtyBoundState(
  session: Pick<TerminalPtySessionState, 'ptyState'>,
): TerminalPtyBoundState | null {
  return session.ptyState.kind === 'bound' ? session.ptyState : null
}

export function terminalPtyProcessName(session: Pick<TerminalPtySessionState, 'ptyState'>): string {
  return session.ptyState.kind === 'bound' ? session.ptyState.processName : 'terminal'
}

export interface TerminalPtyBindingEvents<TSession extends TerminalPtySessionState> {
  isSessionLive(session: TSession): boolean
  emitLifecycle(session: TSession): void
  emitOutput(session: TSession, event: Omit<TerminalOutputEvent, 'terminalSessionId'>): void
  emitBell(session: TSession, event: Omit<TerminalBellRealtimeEvent, 'terminalSessionId' | 'workspaceId'>): void
  emitTitle(session: TSession, event: Omit<TerminalTitleEvent, 'terminalSessionId' | 'workspaceId'>): void
  emitExit(
    session: TSession,
    event: Omit<TerminalExitEvent, 'terminalSessionId' | 'workspaceId' | 'workspaceRuntimeId'>,
  ): void
  confirmedExit(session: TSession, terminalRuntimeGeneration: number): void
}

export class TerminalPtyBinding<TSession extends TerminalPtySessionState> {
  private readonly supervisor: PtySupervisor
  private readonly events: TerminalPtyBindingEvents<TSession>
  private handle: PtyHandle | null = null
  private readonly disposables: Array<{ dispose(): void }> = []
  private inputQueue: PendingInputWrite[] = []
  private readonly inFlightInputBatches = new Set<InFlightInputBatch>()
  private inputFlushScheduled = false
  /** Internal ownership epoch. It is never published as a PTY generation. */
  private spawnAttempt = 0
  private pendingSpawn: Promise<TerminalPtySpawnResult> | null = null
  private readonly pendingSpawns = new Set<PendingSpawnOwnership>()
  // Every handle whose exit has not yet been confirmed remains owned here.
  // Reset/restart may detach it from the active binding, but only a successful
  // supervisor `killAndWait` can release the retirement obligation.
  private readonly retiringHandles = new Map<string, RetiringPtyOwnership>()
  private geometryOperation: Promise<void> = Promise.resolve()

  constructor(supervisor: PtySupervisor, events: TerminalPtyBindingEvents<TSession>) {
    this.supervisor = supervisor
    this.events = events
  }

  hasPendingSpawn(): boolean {
    return this.pendingSpawn !== null
  }

  async spawn(
    session: TSession,
    cols: number,
    rows: number,
    admission: TerminalPtyBindingAdmission,
    signal?: AbortSignal,
  ): Promise<TerminalPtySpawnResult> {
    if (session.ptyState.kind !== 'prepared') return this.staleSpawnResult(this.spawnAttempt, 0)
    const preparedState = session.ptyState
    const attempt = this.beginSpawnAttempt()
    const generation = 1
    const state: TerminalPtyBoundState = {
      kind: 'bound',
      activity: 'active',
      generation,
      cols,
      rows,
      processName: 'terminal',
      render: createEmptyTerminalRenderState(cols, rows),
    }
    const olderSpawns = Array.from(this.pendingSpawns)
    if (markTerminalSessionOpening(session)) this.events.emitLifecycle(session)
    const spawn = this.resolvePreparedSpawn(session, attempt, state, preparedState, olderSpawns, admission, signal)
    try {
      return await this.trackPendingSpawn(spawn)
    } finally {
      if (terminalPtyBoundState(session)?.render !== state.render) disposeRender(state.render)
    }
  }

  async restart(
    session: TSession,
    cols: number,
    rows: number,
    admission: TerminalPtyBindingAdmission,
    signal?: AbortSignal,
  ): Promise<TerminalPtySpawnResult> {
    const current = terminalPtyBoundState(session)
    if (!current) return this.staleSpawnResult(this.spawnAttempt, 0)
    const attempt = this.beginSpawnAttempt()
    const generation = current.generation + 1
    const replacement: TerminalPtyBoundState = {
      kind: 'bound',
      activity: 'active',
      generation,
      cols,
      rows,
      processName: 'terminal',
      render: createEmptyTerminalRenderState(cols, rows),
    }
    const olderSpawns = Array.from(this.pendingSpawns)
    if (markTerminalSessionRestarting(session)) this.events.emitLifecycle(session)
    const spawn = this.resolveReplacement(session, attempt, current, replacement, olderSpawns, admission, signal)
    try {
      return await this.trackPendingSpawn(spawn)
    } finally {
      if (terminalPtyBoundState(session)?.render !== replacement.render) disposeRender(replacement.render)
    }
  }

  private async trackPendingSpawn(spawn: Promise<TerminalPtySpawnResult>): Promise<TerminalPtySpawnResult> {
    this.pendingSpawn = spawn
    try {
      return await spawn
    } finally {
      if (this.pendingSpawn === spawn) this.pendingSpawn = null
    }
  }

  private trackSpawnOwnership(ownership: Promise<void>): PendingSpawnOwnership {
    const consumer = Promise.withResolvers<void>()
    const pending: PendingSpawnOwnership = {
      completion: Promise.resolve(),
      failed: false,
      failure: undefined,
      releaseConsumer: () => consumer.resolve(),
    }
    pending.completion = Promise.all([
      ownership.catch((error: unknown) => {
        pending.failed = true
        pending.failure = error
      }),
      consumer.promise,
    ]).then(() => {
      if (!pending.failed) this.pendingSpawns.delete(pending)
    })
    this.pendingSpawns.add(pending)
    return pending
  }

  private async drainPendingSpawns(
    pendingSpawns: readonly PendingSpawnOwnership[] = Array.from(this.pendingSpawns),
  ): Promise<void> {
    await Promise.all(pendingSpawns.map(async (pending) => await pending.completion))
    for (const pending of pendingSpawns) this.pendingSpawns.delete(pending)
    const failed = pendingSpawns.find((pending) => pending.failed)
    if (failed) throw failed.failure
  }

  async waitForPendingSpawn(session: TSession): Promise<{ ok: false; message: string } | null> {
    for (;;) {
      const pending = this.pendingSpawn
      if (!pending) return null
      const spawn = await pending
      if (spawn.result.ok) return null
      if (!this.isCurrentSpawn(session, spawn.attempt)) continue
      return spawn.result
    }
  }

  isCurrentSpawn(session: TSession, attempt: number): boolean {
    return this.events.isSessionLive(session) && this.spawnAttempt === attempt
  }

  private async resolveReplacement(
    session: TSession,
    attempt: number,
    current: TerminalPtyBoundState,
    replacement: TerminalPtyBoundState,
    olderSpawns: readonly PendingSpawnOwnership[],
    admission: TerminalPtyBindingAdmission,
    signal?: AbortSignal,
  ): Promise<TerminalPtySpawnResult> {
    const generation = replacement.generation
    this.beginRetirement(session)
    try {
      await this.drainPendingSpawns(olderSpawns)
      await this.drainRetiringHandles()
    } catch (error) {
      if (!this.isCurrentSpawn(session, attempt)) return this.staleSpawnResult(attempt, generation)
      return this.spawnResult(attempt, generation, {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      })
    }
    if (!this.isCurrentSpawn(session, attempt)) return this.staleSpawnResult(attempt, generation)
    if (session.ptyState !== current) return this.staleSpawnResult(attempt, generation)
    return await this.resolveSpawn(session, attempt, replacement, current, admission, signal)
  }

  private async resolvePreparedSpawn(
    session: TSession,
    attempt: number,
    state: TerminalPtyBoundState,
    preparedState: Extract<TerminalPtyState, { kind: 'prepared' }>,
    olderSpawns: readonly PendingSpawnOwnership[],
    admission: TerminalPtyBindingAdmission,
    signal?: AbortSignal,
  ): Promise<TerminalPtySpawnResult> {
    const generation = state.generation
    if (olderSpawns.length > 0 || this.retiringHandles.size > 0) {
      try {
        // A completed logical attach attempt does not imply that its native PTY
        // candidate has resolved or retired. Keep the generation-0 retry behind
        // the same physical-ownership barrier as restart.
        await this.drainPendingSpawns(olderSpawns)
        await this.drainRetiringHandles()
      } catch (error) {
        if (!this.isCurrentSpawn(session, attempt)) return this.staleSpawnResult(attempt, generation)
        return this.spawnResult(attempt, generation, {
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }
    if (!this.isCurrentSpawn(session, attempt) || session.ptyState !== preparedState) {
      return this.staleSpawnResult(attempt, generation)
    }
    return await this.resolveSpawn(session, attempt, state, preparedState, admission, signal)
  }

  revokeOwnership(session: TSession): void {
    this.invalidateSpawns()
    this.beginRetirement(session)
  }

  dispose(session: TSession): void {
    this.disposeResources(session)
  }

  async disposeAndWait(session: TSession): Promise<void> {
    await this.retireAndWait(session)
    const state = terminalPtyBoundState(session)
    if (state) disposeRender(state.render)
  }

  /**
   * Retires resources after their session authority has been irreversibly
   * detached. Unlike an ordinary close failure, this state can never be
   * recovered, so its headless render is released even when native PTY
   * termination still needs to be owned until shutdown.
   */
  disposeDetachedAndWait(session: TSession): Promise<void> {
    // Invalidation has already revoked addressability, so no recovery consumer
    // can use this render again. Release it synchronously; only native process
    // retirement survives beyond this boundary.
    this.beginRetirement(session)
    const state = terminalPtyBoundState(session)
    if (state) disposeRender(state.render)
    return this.finishDetachedRetirement(session.id)
  }

  disposeAfterConfirmedExit(session: TSession): void {
    this.beginRetirement(session)
    const state = terminalPtyBoundState(session)
    if (state) disposeRender(state.render)
  }

  async resize(
    session: TSession,
    terminalRuntimeGeneration: number,
    cols: number,
    rows: number,
    admission: TerminalPtyMutationAdmission,
  ): Promise<TerminalPtyResizeResult> {
    return await this.withGeometryBoundary(async () => {
      const state = terminalPtyBoundState(session)
      const handle = this.handle
      if (
        !handle ||
        !state ||
        state.activity !== 'active' ||
        state.generation !== terminalRuntimeGeneration ||
        !admission.validate()
      ) {
        return { accepted: false, changed: false }
      }
      if (state.cols === cols && state.rows === rows) {
        return { accepted: admission.validate() && admission.commit(), changed: false }
      }
      try {
        if (!(await this.supervisor.resize(handle, cols, rows))) return { accepted: false, changed: false }
      } catch (err) {
        ptyLifecycleLogger.warn({ terminalRuntimeSessionId: session.id, err }, 'failed to resize PTY')
        return { accepted: false, changed: false }
      }
      if (
        this.handle !== handle ||
        terminalPtyBoundState(session) !== state ||
        state.activity !== 'active' ||
        state.generation !== terminalRuntimeGeneration
      ) {
        return { accepted: false, changed: false }
      }
      resizeRender(state.render, cols, rows)
      state.cols = cols
      state.rows = rows
      return { accepted: admission.validate() && admission.commit(), changed: true }
    })
  }

  async recoveryAttach(
    session: TSession,
    terminalRuntimeGeneration: number,
    cols: number,
    rows: number,
    admission: TerminalPtyRecoveryAdmission,
  ): Promise<TerminalPtyRecoveryAttachResult> {
    return await this.withGeometryBoundary(async () => {
      const state = terminalPtyBoundState(session)
      const handle = this.handle
      const geometry = admission.prepare()
      if (!state || state.generation !== terminalRuntimeGeneration || geometry === null) {
        return { accepted: false, changed: false, snapshot: null }
      }

      let changed = false
      if (geometry === 'resize') {
        if (!handle || state.activity !== 'active') return { accepted: false, changed: false, snapshot: null }
        if (state.cols !== cols || state.rows !== rows) {
          try {
            if (!(await this.supervisor.resize(handle, cols, rows))) {
              return { accepted: false, changed: false, snapshot: null }
            }
          } catch (err) {
            ptyLifecycleLogger.warn({ terminalRuntimeSessionId: session.id, err }, 'failed to resize PTY')
            return { accepted: false, changed: false, snapshot: null }
          }
          if (
            this.handle !== handle ||
            terminalPtyBoundState(session) !== state ||
            state.activity !== 'active' ||
            state.generation !== terminalRuntimeGeneration
          ) {
            return { accepted: false, changed: false, snapshot: null }
          }
          resizeRender(state.render, cols, rows)
          state.cols = cols
          state.rows = rows
          changed = true
        }
      }

      const snapshot = await replaySnapshot(state.render)
      if (
        !snapshot ||
        terminalPtyBoundState(session) !== state ||
        state.generation !== terminalRuntimeGeneration ||
        !admission.commit()
      ) {
        return { accepted: false, changed, snapshot: null }
      }
      return {
        accepted: true,
        changed,
        snapshot: {
          ...snapshot,
          generation: state.generation,
          canonicalSize: { cols: state.cols, rows: state.rows },
        },
      }
    })
  }

  write(session: TSession, data: string): Promise<TerminalWriteResult> {
    if (!this.handle || terminalPtyBoundState(session)?.activity !== 'active') {
      return Promise.resolve({ status: 'rejected' })
    }
    return new Promise<TerminalWriteResult>((resolve) => {
      this.inputQueue.push({ data, resolve })
      this.scheduleInputFlush(session)
    })
  }

  private async resolveSpawn(
    session: TSession,
    attempt: number,
    state: TerminalPtyBoundState,
    previousState: TerminalPtyState,
    admission: TerminalPtyBindingAdmission,
    signal?: AbortSignal,
  ): Promise<TerminalPtySpawnResult> {
    const generation = state.generation
    // Failure handling stays with the caller:
    // - create failures retire operation-owned resources without Directory publication;
    // - restart failures keep the session addressable for a later retry.
    let spawn: AbortablePtySpawn
    try {
      spawn = abortablePtySpawn(
        this.supervisor,
        {
          command: session.command,
          args: session.args,
          startupShellCommand: session.startupShellCommand,
          cwd: session.cwd,
          cols: state.cols,
          rows: state.rows,
          env: session.env,
        },
        signal,
        async (lateSpawn) => {
          lateSpawn.events.dispose()
          await this.killStalePtyHandle(lateSpawn.handle)
        },
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : 'error.unknown'
      return this.isCurrentSpawn(session, attempt)
        ? this.spawnResult(attempt, generation, { ok: false, message })
        : this.staleSpawnResult(attempt, generation)
    }
    const ownership = this.trackSpawnOwnership(spawn.ownership)
    try {
      let resolved: PtySpawnResult
      try {
        resolved = await spawn.result
      } catch (err) {
        const message = err instanceof Error ? err.message : 'error.unknown'
        return this.isCurrentSpawn(session, attempt)
          ? this.spawnResult(attempt, generation, { ok: false, message })
          : this.staleSpawnResult(attempt, generation)
      }
      if (!resolved.ok) {
        if (!this.isCurrentSpawn(session, attempt)) return this.staleSpawnResult(attempt, generation)
        return this.spawnResult(attempt, generation, resolved)
      }
      if (!this.isCurrentSpawn(session, attempt)) {
        resolved.events.dispose()
        await this.killStalePtyHandle(resolved.handle)
        return this.staleSpawnResult(attempt, generation)
      }
      try {
        this.bindHandle(
          session,
          state,
          previousState,
          resolved.handle,
          resolved.processName,
          resolved.events,
          admission,
        )
      } catch (error) {
        this.beginRetirement(session)
        resolved.events.dispose()
        let failure = error
        try {
          await this.killStalePtyHandle(resolved.handle)
        } catch (retirementError) {
          failure = retirementError
        }
        const message = failure instanceof Error ? failure.message : String(failure)
        return this.isCurrentSpawn(session, attempt)
          ? this.spawnResult(attempt, generation, { ok: false, message })
          : this.staleSpawnResult(attempt, generation)
      }
      if (previousState.kind === 'bound') disposeRender(previousState.render)
      if (!this.isCurrentSpawn(session, attempt) || this.handle !== resolved.handle) {
        return this.staleSpawnResult(attempt, generation)
      }
      return this.spawnResult(attempt, generation, { ok: true })
    } finally {
      ownership.releaseConsumer()
    }
  }

  private bindHandle(
    session: TSession,
    state: TerminalPtyBoundState,
    previousState: TerminalPtyState,
    handle: PtyHandle,
    initialProcessName: string,
    events: PtyEventLease,
    admission: TerminalPtyBindingAdmission,
  ): void {
    const generation = state.generation
    const render = state.render
    state.processName = initialProcessName
    let lastBroadcastTitle: string | null = render.title
    let lastProcessName = initialProcessName
    const claim = events.claim({
      onData: ({ data, processName: processNameAfterData }) => {
        if (!this.isCurrentBinding(session, generation, handle)) return
        const titleBeforeData = render.title
        const processNameBeforeData = lastProcessName

        const output = appendOutput(render, data)

        lastProcessName = processNameAfterData
        state.processName = processNameAfterData
        let eventCanonicalTitle = titleBeforeData
        const hasTitleUpdate = output.controlEvents.some((event) => event.type === 'title')

        // Stale title detection: when a child process exits without
        // setting a new title-OSC, the tab would keep showing the
        // child's title. Detect the non-shell -> shell process name
        // transition with no title update in the chunk and clear it before
        // any bell in the same chunk is emitted.
        if (
          titleBeforeData !== null &&
          !hasTitleUpdate &&
          render.title === titleBeforeData &&
          !isShellProcessName(processNameBeforeData) &&
          isShellProcessName(processNameAfterData)
        ) {
          applyTerminalTitle(render, null)
          eventCanonicalTitle = null
          if (lastBroadcastTitle !== null) {
            lastBroadcastTitle = null
            this.events.emitTitle(session, {
              terminalRuntimeSessionId: session.id,
              terminalRuntimeGeneration: generation,
              canonicalTitle: null,
            })
          }
        }

        for (const event of output.controlEvents) {
          if (event.type === 'title') {
            applyTerminalTitle(render, event.title)
            eventCanonicalTitle = event.title
            if (eventCanonicalTitle !== lastBroadcastTitle) {
              lastBroadcastTitle = eventCanonicalTitle
              this.events.emitTitle(session, {
                terminalRuntimeSessionId: session.id,
                terminalRuntimeGeneration: generation,
                canonicalTitle: eventCanonicalTitle,
              })
            }
            continue
          }
          this.events.emitBell(session, {
            terminalRuntimeSessionId: session.id,
            terminalRuntimeGeneration: generation,
            processName: processNameAfterData,
            canonicalTitle: eventCanonicalTitle,
          })
        }
        this.events.emitOutput(session, {
          terminalRuntimeSessionId: session.id,
          terminalRuntimeGeneration: generation,
          data,
          seq: output.seq,
          processName: processNameAfterData,
        })
      },
      onExit: () => {
        if (!this.isCurrentBinding(session, generation, handle)) return
        this.handle = null
        state.activity = 'retained'
        try {
          this.events.emitExit(session, { terminalRuntimeSessionId: session.id, terminalRuntimeGeneration: generation })
        } finally {
          this.events.confirmedExit(session, generation)
        }
      },
    })
    let adopted = false
    try {
      admission.commit()
      session.ptyState = state
      this.handle = handle
      this.disposables.push(claim)
      claim.activate()
      adopted = true
      // A quiet process that waits for stdin is open once its native handle,
      // bound state, and ordered event owner have committed.
      if (this.isCurrentBinding(session, generation, handle) && markTerminalSessionOpen(session)) {
        try {
          this.events.emitLifecycle(session)
        } catch (error) {
          ptyLifecycleLogger.warn(
            { terminalRuntimeSessionId: session.id, err: error },
            'failed to publish committed PTY lifecycle',
          )
        }
      }
    } catch (error) {
      // Once activation succeeds, buffered data/exit may already be visible.
      // Rolling authority back after that boundary would publish two histories.
      if (adopted) throw error
      admission.rollback()
      if (session.ptyState === state) session.ptyState = previousState
      if (this.handle === handle) this.handle = null
      const claimIndex = this.disposables.indexOf(claim)
      if (claimIndex >= 0) this.disposables.splice(claimIndex, 1)
      claim.dispose()
      throw error
    }
  }

  private beginSpawnAttempt(): number {
    this.spawnAttempt += 1
    return this.spawnAttempt
  }

  private invalidateSpawns(): void {
    this.spawnAttempt += 1
  }

  private isCurrentBinding(session: TSession, generation: number, handle: PtyHandle): boolean {
    return this.handle === handle && terminalPtyBoundState(session)?.generation === generation
  }

  private spawnResult(attempt: number, generation: number, result: TerminalPtySpawnOutcome): TerminalPtySpawnResult {
    return { attempt, generation, result }
  }

  private staleSpawnResult(attempt: number, generation: number): TerminalPtySpawnResult {
    return this.spawnResult(attempt, generation, { ok: false, message: 'error.unavailable' })
  }

  private async killStalePtyHandle(handle: PtyHandle): Promise<void> {
    await this.drainRetiringHandle(this.retainRetiringHandle(handle))
  }

  private disposeResources(session: TSession): void {
    this.beginRetirement(session)
    const state = terminalPtyBoundState(session)
    if (state) disposeRender(state.render)
    for (const retiring of this.retiringHandles.values()) {
      if (retiring.attempt) continue
      try {
        this.supervisor.kill(retiring.handle)
      } catch (err) {
        ptyLifecycleLogger.warn({ terminalRuntimeSessionId: session.id, err }, 'failed to kill PTY')
      }
    }
  }

  private beginRetirement(session: TSession): void {
    this.disposeListeners(session.id)
    if (this.handle) this.retainRetiringHandle(this.handle)
    const state = terminalPtyBoundState(session)
    if (state) state.activity = 'retained'
    this.handle = null
    this.settleQueuedInput({ status: 'rejected' })
    for (const batch of Array.from(this.inFlightInputBatches)) {
      this.settleInputBatch(batch, { status: 'indeterminate' })
      this.inFlightInputBatches.delete(batch)
    }
    this.inputFlushScheduled = false
  }

  private async drainRetiringHandles(): Promise<void> {
    for (const retiring of Array.from(this.retiringHandles.values())) {
      await this.drainRetiringHandle(retiring)
    }
  }

  private async retireAndWait(session: TSession): Promise<void> {
    while (this.pendingSpawns.size > 0) await this.drainPendingSpawns()
    this.beginRetirement(session)
    await this.drainRetiringHandles()
  }

  private async finishDetachedRetirement(terminalRuntimeSessionId: string): Promise<void> {
    try {
      while (this.pendingSpawns.size > 0) await this.drainPendingSpawns()
      await this.drainRetiringHandles()
    } catch (error) {
      ptyLifecycleLogger.warn(
        { terminalRuntimeSessionId, err: error },
        'waiting for eventual exit after detached PTY retirement did not complete in time',
      )
      await this.waitForRetiringHandlesToExit()
    }
  }

  private retainRetiringHandle(handle: PtyHandle): RetiringPtyOwnership {
    const existing = this.retiringHandles.get(handle.ptySessionId)
    if (existing) return existing
    const retiring: RetiringPtyOwnership = {
      handle,
      attempt: null,
      exited: Promise.resolve(),
    }
    this.retiringHandles.set(handle.ptySessionId, retiring)
    retiring.exited = this.supervisor.waitForExit(handle).then(() => {
      if (this.retiringHandles.get(handle.ptySessionId) === retiring) {
        this.retiringHandles.delete(handle.ptySessionId)
      }
    })
    return retiring
  }

  private async waitForRetiringHandlesToExit(): Promise<void> {
    await Promise.all(Array.from(this.retiringHandles.values(), (retiring) => retiring.exited))
  }

  private async drainRetiringHandle(retiring: RetiringPtyOwnership): Promise<void> {
    if (this.retiringHandles.get(retiring.handle.ptySessionId) !== retiring) return
    let attempt = retiring.attempt
    if (!attempt) {
      const deferred = Promise.withResolvers<void>()
      attempt = deferred.promise
      retiring.attempt = attempt
      try {
        void this.supervisor.killAndWait(retiring.handle).then(deferred.resolve, deferred.reject)
      } catch (error) {
        deferred.reject(error)
      }
    }
    try {
      await attempt
    } catch (error) {
      if (retiring.attempt === attempt) retiring.attempt = null
      throw error
    }
    if (this.retiringHandles.get(retiring.handle.ptySessionId) === retiring && retiring.attempt === attempt) {
      this.retiringHandles.delete(retiring.handle.ptySessionId)
    }
  }

  private disposeListeners(terminalRuntimeSessionId: string): void {
    for (const disposable of this.disposables.splice(0)) {
      try {
        disposable.dispose()
      } catch (err) {
        ptyLifecycleLogger.warn({ terminalRuntimeSessionId, err }, 'failed to dispose PTY listener')
      }
    }
  }

  private scheduleInputFlush(session: TSession): void {
    if (this.inputFlushScheduled || this.inputQueue.length === 0 || !this.handle) return
    this.inputFlushScheduled = true
    queueMicrotask(() => {
      this.inputFlushScheduled = false
      void this.drainInputQueue(session)
    })
  }

  private async drainInputQueue(session: TSession): Promise<void> {
    if (this.inputQueue.length === 0) return
    const writes = this.inputQueue.splice(0)
    const handle = this.handle
    if (!handle) {
      for (const write of writes) write.resolve({ status: 'rejected' })
      return
    }
    const batch: InFlightInputBatch = { writes, settled: false }
    this.inFlightInputBatches.add(batch)
    const data = writes.map((write) => write.data).join('')
    try {
      const result = await this.supervisor.write(handle, data)
      this.settleInputBatch(batch, result)
    } catch (err) {
      ptyLifecycleLogger.warn(
        { terminalRuntimeSessionId: session.id, err, bytes: Buffer.byteLength(data, 'utf8') },
        'failed to write PTY',
      )
      this.settleInputBatch(batch, { status: 'indeterminate' })
    } finally {
      this.inFlightInputBatches.delete(batch)
    }
  }

  private settleQueuedInput(result: TerminalWriteResult): void {
    for (const write of this.inputQueue.splice(0)) write.resolve(result)
  }

  private settleInputBatch(batch: InFlightInputBatch, result: TerminalWriteResult): void {
    if (batch.settled) return
    batch.settled = true
    for (const write of batch.writes) write.resolve(result)
  }

  private async withGeometryBoundary<TResult>(operation: () => Promise<TResult>): Promise<TResult> {
    const result = this.geometryOperation.then(operation, operation)
    this.geometryOperation = result.then(
      () => undefined,
      () => undefined,
    )
    return await result
  }
}

function abortablePtySpawn(
  supervisor: PtySupervisor,
  input: PtySpawnInput,
  signal: AbortSignal | undefined,
  retireLateSpawn: (spawn: Extract<PtySpawnResult, { ok: true }>) => Promise<void>,
): AbortablePtySpawn {
  if (signal?.aborted) {
    return {
      result: Promise.resolve({ ok: false, message: 'error.workspace-runtime-stale' }),
      ownership: Promise.resolve(),
    }
  }
  const spawn = supervisor.spawn(input)
  if (!signal) {
    return {
      result: spawn,
      ownership: spawn.then(
        () => undefined,
        () => undefined,
      ),
    }
  }
  const result = Promise.withResolvers<PtySpawnResult>()
  let settled = false
  let abandoned = false
  const aborted = () => {
    if (settled) return
    abandoned = true
    settled = true
    result.resolve({ ok: false, message: 'error.workspace-runtime-stale' })
  }
  signal.addEventListener('abort', aborted, { once: true })
  const ownership = spawn.then(
    async (spawnResult) => {
      signal.removeEventListener('abort', aborted)
      if (abandoned) {
        if (spawnResult.ok) await retireLateSpawn(spawnResult)
        return
      }
      if (settled) return
      settled = true
      result.resolve(spawnResult)
    },
    (error: unknown) => {
      signal.removeEventListener('abort', aborted)
      if (settled) return
      settled = true
      result.resolve({ ok: false, message: error instanceof Error ? error.message : 'error.unknown' })
    },
  )
  return { result: result.promise, ownership }
}
