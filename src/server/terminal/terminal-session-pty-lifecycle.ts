import {
  type TerminalExitEvent,
  type TerminalBellRealtimeEvent,
  type TerminalOutputEvent,
  type TerminalSessionPhase,
  type TerminalTitleEvent,
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
}

export interface TerminalPtyBindingEvents<TSession extends TerminalPtySessionState> {
  isSessionLive(session: TSession): boolean
  emitLifecycle(session: TSession): void
  emitOutput(session: TSession, event: Omit<TerminalOutputEvent, 'terminalSessionId'>): void
  emitBell(
    session: TSession,
    event: Omit<TerminalBellRealtimeEvent, 'terminalSessionId' | 'repoRoot' | 'worktreePath'>,
  ): void
  emitTitle(session: TSession, event: Omit<TerminalTitleEvent, 'terminalSessionId' | 'repoRoot' | 'worktreePath'>): void
  emitExit(session: TSession, event: Omit<TerminalExitEvent, 'terminalSessionId'>): void
  closeSession(terminalRuntimeSessionId: string): void
}

export class TerminalPtyBinding<TSession extends TerminalPtySessionState> {
  private readonly supervisor: PtySupervisor
  private readonly events: TerminalPtyBindingEvents<TSession>
  private handle: PtyHandle | null = null
  private readonly disposables: Array<{ dispose(): void }> = []
  private inputQueue: string[] = []
  private inputFlushScheduled = false
  private spawnGeneration = 0
  private pendingSpawn: Promise<TerminalPtySpawnResult> | null = null

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

  async spawn(session: TSession): Promise<TerminalPtySpawnResult> {
    // This pending promise covers only PTY spawn/bind ownership. The
    // manager builds attach first-frame results after a successful bind.
    const generation = this.beginSpawn()
    const spawn = this.resolveSpawn(session, generation)
    this.pendingSpawn = spawn
    try {
      return await spawn
    } finally {
      if (this.pendingSpawn === spawn) this.pendingSpawn = null
    }
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

  reset(session: TSession, cols: number, rows: number, phase: 'opening' | 'restarting' = 'opening'): void {
    this.invalidateOwnership()
    this.disposeResources(session)
    session.cols = cols
    session.rows = rows
    const phaseChanged =
      phase === 'restarting' ? markTerminalSessionRestarting(session) : markTerminalSessionOpening(session)
    resetRender(session.render, cols, rows)
    if (phaseChanged) this.events.emitLifecycle(session)
  }

  invalidateOwnership(): void {
    this.invalidateSpawns()
  }

  dispose(session: TSession): void {
    this.disposeResources(session)
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

  write(session: TSession, data: string): boolean {
    if (!this.handle) return false
    this.inputQueue.push(data)
    this.scheduleInputFlush(session)
    return true
  }

  private async resolveSpawn(session: TSession, generation: number): Promise<TerminalPtySpawnResult> {
    // Failure handling stays with the caller:
    // - create failures remove the just-created session from manager maps;
    // - restart failures keep the session addressable for a later retry.
    let resolved: { ok: true; handle: PtyHandle; processName: string } | { ok: false; message: string }
    try {
      resolved = await this.supervisor.spawn({
        command: session.command,
        args: session.args,
        startupShellCommand: session.startupShellCommand,
        cwd: session.cwd,
        cols: session.cols,
        rows: session.rows,
        env: session.env,
      })
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
      this.killStalePtyHandle(session.id, resolved.handle)
      return this.staleSpawnResult(generation)
    }
    this.bindHandle(session, generation, resolved.handle)
    return this.spawnResult(generation, { ok: true })
  }

  private bindHandle(session: TSession, generation: number, handle: PtyHandle): void {
    this.handle = handle
    let lastBroadcastTitle: string | null = session.render.title
    let lastProcessName: string = this.supervisor.processName(handle)
    this.disposables.push(
      this.supervisor.onData(handle, (data) => {
        if (!this.isCurrentBinding(session, generation, handle)) return
        if (markTerminalSessionOpen(session)) this.events.emitLifecycle(session)
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
                canonicalTitle: eventCanonicalTitle,
              })
            }
            continue
          }
          this.events.emitBell(session, {
            terminalRuntimeSessionId: session.id,
            processName: processNameAfterData,
            canonicalTitle: eventCanonicalTitle,
          })
        }
        this.events.emitOutput(session, {
          terminalRuntimeSessionId: session.id,
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
        this.events.emitExit(session, { terminalRuntimeSessionId: session.id })
        this.events.closeSession(session.id)
      }),
    )
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

  private killStalePtyHandle(terminalRuntimeSessionId: string, handle: PtyHandle): void {
    try {
      this.supervisor.kill(handle)
    } catch (err) {
      ptyLifecycleLogger.warn({ terminalRuntimeSessionId, err }, 'failed to kill stale PTY')
    }
  }

  private disposeResources(session: TSession): void {
    this.disposeListeners(session.id)
    disposeRender(session.render)
    if (this.handle) {
      try {
        this.supervisor.kill(this.handle)
      } catch (err) {
        ptyLifecycleLogger.warn({ terminalRuntimeSessionId: session.id, err }, 'failed to kill PTY')
      }
    }
    this.handle = null
    this.inputQueue = []
    this.inputFlushScheduled = false
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
      this.drainInputQueue(session)
    })
  }

  private drainInputQueue(session: TSession): void {
    if (this.inputQueue.length === 0 || !this.handle) return
    const batch = this.inputQueue.splice(0).join('')
    try {
      this.supervisor.write(this.handle, batch)
    } catch (err) {
      ptyLifecycleLogger.warn({ terminalRuntimeSessionId: session.id, err, bytes: batch.length }, 'failed to write PTY')
    }
  }
}
