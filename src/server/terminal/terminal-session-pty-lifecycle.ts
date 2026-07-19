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
  disposeRender,
  resetRender,
  resizeRender,
  type TerminalRenderState,
} from '#/server/terminal/terminal-render-state.ts'
import {
  markTerminalSessionOpen,
  markTerminalSessionOpening,
  markTerminalSessionRestarting,
} from '#/server/terminal/terminal-session-lifecycle.ts'
import type { PtyHandle, PtySupervisor } from '#/server/terminal/pty-supervisor.ts'

const ptyLifecycleLogger = serverLogger.child({ module: 'terminal-session-pty-lifecycle' })

type TerminalPtySpawnOutcome = { ok: true } | { ok: false; message: string }
type PtySupervisorSpawnResult = Awaited<ReturnType<PtySupervisor['spawn']>>

interface PendingSpawnOwnership {
  completion: Promise<void>
  failed: boolean
  failure: unknown
  releaseConsumer(): void
}

interface AbortablePtySpawn {
  result: Promise<PtySupervisorSpawnResult>
  ownership: Promise<void>
}

interface RetiringPtyOwnership {
  handle: PtyHandle
  attempt: Promise<void> | null
}

interface PendingInputWrite {
  data: string
  resolve(result: TerminalWriteResult): void
}

interface InFlightInputBatch {
  writes: PendingInputWrite[]
  settled: boolean
}

export interface TerminalPtySpawnResult {
  generation: number
  result: TerminalPtySpawnOutcome
}

export interface TerminalPtySessionState<TUser extends string | number = string | number> {
  id: string
  userId: TUser
  cwd: string
  command?: string
  args?: string[]
  startupShellCommand?: string
  env?: Record<string, string>
  cols: number
  rows: number
  render: TerminalRenderState
  phase: TerminalSessionPhase
  message: string | null
  terminalRuntimeGeneration: number
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
  private spawnGeneration = 0
  private pendingSpawn: Promise<TerminalPtySpawnResult> | null = null
  private readonly pendingSpawns = new Set<PendingSpawnOwnership>()
  // Every handle whose exit has not yet been confirmed remains owned here.
  // Reset/restart may detach it from the active binding, but only a successful
  // supervisor `killAndWait` can release the retirement obligation.
  private readonly retiringHandles = new Map<string, RetiringPtyOwnership>()

  constructor(supervisor: PtySupervisor, events: TerminalPtyBindingEvents<TSession>) {
    this.supervisor = supervisor
    this.events = events
  }

  hasPty(): boolean {
    return this.handle !== null
  }

  processName(): string {
    return this.handle ? this.supervisor.processName(this.handle) : 'terminal'
  }

  generation(): number {
    return this.spawnGeneration
  }

  hasPendingSpawn(): boolean {
    return this.pendingSpawn !== null
  }

  async spawn(session: TSession, cols: number, rows: number, signal?: AbortSignal): Promise<TerminalPtySpawnResult> {
    // The first real xterm fit owns initial PTY geometry. The logical
    // session may have been prepared earlier with a best-effort hint, but no
    // process output exists yet, so resizing the empty headless screen here
    // preserves a single geometry boundary for both PTY and recovery state.
    const generation = this.beginSpawn()
    session.terminalRuntimeGeneration = generation
    session.cols = cols
    session.rows = rows
    resizeRender(session.render, cols, rows)
    if (markTerminalSessionOpening(session)) this.events.emitLifecycle(session)
    const spawn = this.resolveSpawn(session, generation, signal)
    return await this.trackPendingSpawn(spawn)
  }

  async restart(
    session: TSession,
    cols: number,
    rows: number,
    phase: 'opening' | 'restarting' = 'restarting',
    signal?: AbortSignal,
  ): Promise<TerminalPtySpawnResult> {
    const generation = this.beginSpawn()
    const olderSpawns = Array.from(this.pendingSpawns)
    const spawn = this.resolveReplacement(session, generation, olderSpawns, cols, rows, phase, signal)
    return await this.trackPendingSpawn(spawn)
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
      if (!this.isCurrentSpawn(session, spawn.generation)) continue
      return spawn.result
    }
  }

  isCurrentSpawn(session: TSession, generation: number): boolean {
    return this.events.isSessionLive(session) && this.spawnGeneration === generation
  }

  private async resolveReplacement(
    session: TSession,
    generation: number,
    olderSpawns: readonly PendingSpawnOwnership[],
    cols: number,
    rows: number,
    phase: 'opening' | 'restarting' = 'opening',
    signal?: AbortSignal,
  ): Promise<TerminalPtySpawnResult> {
    this.beginRetirement(session)
    try {
      await this.drainPendingSpawns(olderSpawns)
      await this.drainRetiringHandles()
    } catch (error) {
      if (!this.isCurrentSpawn(session, generation)) return this.staleSpawnResult(generation)
      return this.spawnResult(generation, {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      })
    }
    if (!this.isCurrentSpawn(session, generation)) return this.staleSpawnResult(generation)
    session.terminalRuntimeGeneration = generation
    session.cols = cols
    session.rows = rows
    const phaseChanged =
      phase === 'restarting' ? markTerminalSessionRestarting(session) : markTerminalSessionOpening(session)
    resetRender(session.render, cols, rows)
    if (phaseChanged) this.events.emitLifecycle(session)
    return await this.resolveSpawn(session, generation, signal)
  }

  invalidateOwnership(): void {
    this.invalidateSpawns()
  }

  dispose(session: TSession): void {
    this.disposeResources(session)
  }

  async disposeAndWait(session: TSession): Promise<void> {
    while (this.pendingSpawns.size > 0) await this.drainPendingSpawns()
    this.beginRetirement(session)
    await this.drainRetiringHandles()
    disposeRender(session.render)
  }

  disposeAfterConfirmedExit(session: TSession): void {
    this.beginRetirement(session)
    disposeRender(session.render)
  }

  resize(session: TSession, cols: number, rows: number): boolean {
    if (!this.handle) return false
    if (session.cols === cols && session.rows === rows) return true
    try {
      this.supervisor.resize(this.handle, cols, rows)
      resizeRender(session.render, cols, rows)
      session.cols = cols
      session.rows = rows
      return true
    } catch (err) {
      ptyLifecycleLogger.warn({ terminalRuntimeSessionId: session.id, err }, 'failed to resize PTY')
      return false
    }
  }

  write(session: TSession, data: string): Promise<TerminalWriteResult> {
    if (!this.handle) return Promise.resolve({ status: 'rejected' })
    return new Promise<TerminalWriteResult>((resolve) => {
      this.inputQueue.push({ data, resolve })
      this.scheduleInputFlush(session)
    })
  }

  private async resolveSpawn(
    session: TSession,
    generation: number,
    signal?: AbortSignal,
  ): Promise<TerminalPtySpawnResult> {
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
          cols: session.cols,
          rows: session.rows,
          env: session.env,
        },
        signal,
        async (handle) => await this.killStalePtyHandle(handle),
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : 'error.unknown'
      return this.isCurrentSpawn(session, generation)
        ? this.spawnResult(generation, { ok: false, message })
        : this.staleSpawnResult(generation)
    }
    const ownership = this.trackSpawnOwnership(spawn.ownership)
    try {
      let resolved: PtySupervisorSpawnResult
      try {
        resolved = await spawn.result
      } catch (err) {
        const message = err instanceof Error ? err.message : 'error.unknown'
        return this.isCurrentSpawn(session, generation)
          ? this.spawnResult(generation, { ok: false, message })
          : this.staleSpawnResult(generation)
      }
      if (!resolved.ok) {
        if (!this.isCurrentSpawn(session, generation)) return this.staleSpawnResult(generation)
        return this.spawnResult(generation, resolved)
      }
      if (!this.isCurrentSpawn(session, generation)) {
        await this.killStalePtyHandle(resolved.handle)
        return this.staleSpawnResult(generation)
      }
      this.bindHandle(session, generation, resolved.handle)
      return this.spawnResult(generation, { ok: true })
    } finally {
      ownership.releaseConsumer()
    }
  }

  private bindHandle(session: TSession, generation: number, handle: PtyHandle): void {
    this.handle = handle
    session.terminalRuntimeGeneration = generation
    let lastBroadcastTitle: string | null = session.render.title
    let lastProcessName: string = this.supervisor.processName(handle)
    this.disposables.push(
      this.supervisor.onData(handle, (data) => {
        if (!this.isCurrentBinding(session, generation, handle)) return
        const titleBeforeData = session.render.title
        const processNameBeforeData = lastProcessName

        const output = appendOutput(session.render, data)

        const processNameAfterData = this.supervisor.processName(handle)
        lastProcessName = processNameAfterData
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
          session.render.title === titleBeforeData &&
          !isShellProcessName(processNameBeforeData) &&
          isShellProcessName(processNameAfterData)
        ) {
          applyTerminalTitle(session.render, null)
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
            applyTerminalTitle(session.render, event.title)
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
          outputEra: output.outputEra,
          seq: output.seq,
          processName: processNameAfterData,
        })
      }),
    )
    this.disposables.push(
      this.supervisor.onExit(handle, () => {
        if (!this.isCurrentBinding(session, generation, handle)) return
        this.handle = null
        this.events.emitExit(session, { terminalRuntimeSessionId: session.id, terminalRuntimeGeneration: generation })
        this.events.confirmedExit(session, generation)
      }),
    )
    // `open` is the process-ready boundary: the supervisor returned a live
    // handle and both data and exit listeners now own it. Output acceptance
    // remains represented by render sequence/checkpoints, not lifecycle.
    // A quiet process that waits for stdin must be writable before producing
    // its first byte.
    if (markTerminalSessionOpen(session)) this.events.emitLifecycle(session)
  }

  private beginSpawn(): number {
    this.spawnGeneration += 1
    return this.spawnGeneration
  }

  private invalidateSpawns(): void {
    this.spawnGeneration += 1
  }

  private isCurrentBinding(session: TSession, generation: number, handle: PtyHandle): boolean {
    return this.isCurrentSpawn(session, generation) && this.handle === handle
  }

  private spawnResult(generation: number, result: TerminalPtySpawnOutcome): TerminalPtySpawnResult {
    return { generation, result }
  }

  private staleSpawnResult(generation: number): TerminalPtySpawnResult {
    return this.spawnResult(generation, { ok: false, message: 'error.unavailable' })
  }

  private async killStalePtyHandle(handle: PtyHandle): Promise<void> {
    await this.drainRetiringHandle(this.retainRetiringHandle(handle))
  }

  private disposeResources(session: TSession): void {
    this.beginRetirement(session)
    disposeRender(session.render)
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

  private retainRetiringHandle(handle: PtyHandle): RetiringPtyOwnership {
    const existing = this.retiringHandles.get(handle.ptySessionId)
    if (existing) return existing
    const retiring = { handle, attempt: null }
    this.retiringHandles.set(handle.ptySessionId, retiring)
    return retiring
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
      ptyLifecycleLogger.warn({ terminalRuntimeSessionId: session.id, err, bytes: data.length }, 'failed to write PTY')
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
}

function abortablePtySpawn(
  supervisor: PtySupervisor,
  input: Parameters<PtySupervisor['spawn']>[0],
  signal: AbortSignal | undefined,
  retireLateHandle: (handle: PtyHandle) => Promise<void>,
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
  const result = Promise.withResolvers<PtySupervisorSpawnResult>()
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
        if (spawnResult.ok) await retireLateHandle(spawnResult.handle)
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
