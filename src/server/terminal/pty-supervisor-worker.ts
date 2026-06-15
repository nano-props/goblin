// Main-side IPC bridge to the PTY worker subprocess. Implements the
// `PtySupervisor` interface by translating high-level supervisor calls
// into the small PTY-only wire protocol. The worker is spawned lazily
// (on first use) and respawned with exponential backoff when it dies
// while sessions are still active. When all sessions are gone, the
// worker is left to exit on its own (or killed during shutdown).

import { spawn, type ChildProcess } from 'node:child_process'
import crypto from 'node:crypto'
import { existsSync } from 'node:fs'
import { serverLogger } from '#/server/logger.ts'
import {
  createPtyHandle,
  type PtyHandle,
  type PtySpawnInput,
  type PtySpawnResult,
  type PtySupervisor,
} from '#/server/terminal/pty-supervisor.ts'
import { normalizePtyWorkerMessage, type PtyWorkerMessage } from '#/server/terminal/pty-worker-protocol.ts'
import type { PtySupervisorDiagnostics, PtySupervisorFailureDiagnostics } from '#/server/terminal/terminal-host.ts'
import { resolvePtyWorkerEntry } from '#/server/terminal/pty-worker-entry.ts'

const STABLE_WORKER_UPTIME_MS = 15_000
const MIN_RESTART_BACKOFF_MS = 250
const MAX_RESTART_BACKOFF_MS = 5_000
const ptyWorkerLogger = serverLogger.child({ module: 'pty-supervisor-worker' })

type WorkerTimerHandle = ReturnType<typeof setTimeout> | number
type TerminalWorkerChildProcess = ChildProcess

interface PendingSpawn {
  resolve(value: PtySpawnResult): void
}

interface SessionListeners {
  data: Set<(data: string) => void>
  exit: Set<(code: number | null, signal: NodeJS.Signals | null) => void>
}

export interface WorkerBackedPtySupervisorOptions {
  workerEntry?: string
  /** Resolved at construction when omitted. The default matches the
   *  layout produced by `bun run build:server` (worker entry sits
   *  next to the main bundle in `dist/server`). */
  workerEntryDir?: string
  fileExists?: typeof existsSync
  spawnWorker?: (entry: string) => TerminalWorkerChildProcess
  now?: () => number
  setTimer?: (callback: () => void, delayMs: number) => WorkerTimerHandle
  clearTimer?: (timer: WorkerTimerHandle) => void
}

export class WorkerBackedPtySupervisor implements PtySupervisor {
  readonly mode = 'worker-backed' as const
  private readonly options: WorkerBackedPtySupervisorOptions
  private worker: TerminalWorkerChildProcess | null = null
  private workerStartedAt = 0
  private readonly pendingSpawns = new Map<string, PendingSpawn>()
  private readonly sessions = new Map<string, { processName: string; listeners: SessionListeners }>()
  private restartAttempts = 0
  private restartTimer: WorkerTimerHandle | null = null
  private shuttingDown = false
  private lastSuccessfulResponseAt: number | null = null
  private lastExitCode: number | null = null
  private lastExitSignal: NodeJS.Signals | null = null
  private lastFailure: PtySupervisorFailureDiagnostics | null = null

  constructor(options: WorkerBackedPtySupervisorOptions = {}) {
    this.options = options
  }

  async spawn(input: PtySpawnInput): Promise<PtySpawnResult> {
    const worker = this.ensureWorker()
    const requestId = createRequestId()
    return await new Promise<PtySpawnResult>((resolve) => {
      this.pendingSpawns.set(requestId, { resolve })
      const sent = worker.send({ type: 'pty-spawn', requestId, input })
      if (!sent) {
        this.pendingSpawns.delete(requestId)
        this.recordFailure('send-failed', `action=pty-spawn`)
        resolve({ ok: false, message: this.unavailableMessage() })
      }
    })
  }

  // Fire-and-forget writes. `ensureWorker()` returns the live worker;
  // if the worker just died and we haven't seen the 'exit' event yet
  // the send is a no-op. That race window is microsecond-wide; the
  // next 'exit' will fan out the failure to listeners, and a missed
  // keystroke is preferable to a thrown caller exception.
  write(handle: PtyHandle, data: string): void {
    if (this.shuttingDown) return
    const worker = this.worker
    if (!worker) return
    worker.send({ type: 'pty-write', sessionId: handle.sessionId, data })
  }

  resize(handle: PtyHandle, cols: number, rows: number): void {
    if (this.shuttingDown) return
    const worker = this.worker
    if (!worker) return
    worker.send({ type: 'pty-resize', sessionId: handle.sessionId, cols, rows })
  }

  kill(handle: PtyHandle): void {
    if (this.shuttingDown) return
    this.ensureWorker().send({ type: 'pty-kill', sessionId: handle.sessionId })
  }

  onData(handle: PtyHandle, listener: (data: string) => void): { dispose(): void } {
    const session = this.getOrCreateSession(handle.sessionId, 'terminal')
    session.listeners.data.add(listener)
    return {
      dispose: () => {
        const current = this.sessions.get(handle.sessionId)
        current?.listeners.data.delete(listener)
      },
    }
  }

  onExit(
    handle: PtyHandle,
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): { dispose(): void } {
    const session = this.getOrCreateSession(handle.sessionId, 'terminal')
    session.listeners.exit.add(listener)
    return {
      dispose: () => {
        const current = this.sessions.get(handle.sessionId)
        current?.listeners.exit.delete(listener)
      },
    }
  }

  processName(handle: PtyHandle): string {
    return this.sessions.get(handle.sessionId)?.processName ?? 'terminal'
  }

  getDiagnostics(): PtySupervisorDiagnostics {
    return {
      mode: 'worker-backed',
      state: this.currentState(),
      workerRunning: this.worker !== null,
      workerPid: this.worker?.pid ?? null,
      workerStartedAt: this.worker ? this.workerStartedAt : null,
      workerUptimeMs: this.worker ? Math.max(0, this.now() - this.workerStartedAt) : null,
      pendingRequests: this.pendingSpawns.size,
      restartAttempts: this.restartAttempts,
      restartScheduled: this.restartTimer !== null,
      shuttingDown: this.shuttingDown,
      lastSuccessfulResponseAt: this.lastSuccessfulResponseAt,
      lastExitCode: this.lastExitCode,
      lastExitSignal: this.lastExitSignal,
      lastFailure: this.lastFailure,
    }
  }

  shutdown(): void {
    if (this.shuttingDown) return
    this.shuttingDown = true
    this.clearRestartTimer()
    const worker = this.worker
    this.worker = null
    // Reject any in-flight spawns.
    for (const pending of this.pendingSpawns.values()) {
      pending.resolve({ ok: false, message: 'PTY worker stopped' })
    }
    this.pendingSpawns.clear()
    // Drop all listener state — the runtime that owns us has already
    // called ptySupervisor.shutdown and is closing its own sessions.
    this.sessions.clear()
    if (worker) {
      try {
        worker.send({ type: 'shutdown' })
      } catch {}
      try {
        worker.disconnect?.()
      } catch {}
      try {
        worker.kill()
      } catch {}
    }
  }

  private ensureWorker(): TerminalWorkerChildProcess {
    this.clearRestartTimer()
    if (this.worker) return this.worker
    const entry = this.resolveWorkerEntry()
    const worker = this.options.spawnWorker ? this.options.spawnWorker(entry) : defaultSpawnWorker(entry)
    this.workerStartedAt = this.now()
    ptyWorkerLogger.info(
      { pid: worker.pid, restartAttempts: this.restartAttempts, sessions: this.sessions.size },
      'spawned PTY worker',
    )
    worker.on('message', (raw) => {
      const message = normalizePtyWorkerMessage(raw)
      if (!message) {
        ptyWorkerLogger.warn({ raw: typeof raw }, 'dropped malformed PTY worker message')
        return
      }
      this.handleWorkerMessage(message)
    })
    worker.once('exit', (code, signal) => {
      if (this.worker === worker) this.worker = null
      // Capture "did we have any active sessions" before the listener-fanout
      // step clears them. If we had live PTYs when the worker died, the
      // main process likely still needs the worker back to serve them.
      const hadSessions = this.sessions.size > 0
      if (!this.shuttingDown) {
        const uptimeMs = Math.max(0, this.now() - this.workerStartedAt)
        this.lastExitCode = code ?? null
        this.lastExitSignal = signal ?? null
        this.recordFailure('exit', `code=${code ?? 'null'} signal=${signal ?? 'null'} uptimeMs=${uptimeMs}`)
        if (uptimeMs >= STABLE_WORKER_UPTIME_MS) this.restartAttempts = 0
        else this.restartAttempts += 1
        ptyWorkerLogger.warn(
          {
            pid: worker.pid,
            code,
            signal,
            uptimeMs,
            restartAttempts: this.restartAttempts,
            sessions: this.sessions.size,
          },
          'PTY worker exited',
        )
      }
      this.failPendingSpawns('PTY worker exited')
      this.failSessionListenersOnWorkerExit()
      if (!this.shuttingDown && hadSessions) this.scheduleRestart()
    })
    worker.once('error', (error) => {
      this.recordFailure('error', error instanceof Error ? error.message : String(error))
      ptyWorkerLogger.error({ err: error, pid: worker.pid, sessions: this.sessions.size }, 'PTY worker process error')
      if (this.worker === worker) this.worker = null
      const hadSessions = this.sessions.size > 0
      this.failPendingSpawns(error instanceof Error ? error : new Error(String(error)))
      this.failSessionListenersOnWorkerExit()
      if (!this.shuttingDown && hadSessions) this.scheduleRestart()
    })
    this.worker = worker
    return worker
  }

  private handleWorkerMessage(message: PtyWorkerMessage): void {
    if (message.type === 'pty-spawn-result') {
      const pending = this.pendingSpawns.get(message.requestId)
      if (!pending) return
      this.pendingSpawns.delete(message.requestId)
      if (message.ok) {
        this.lastSuccessfulResponseAt = this.now()
        this.restartAttempts = 0
        const handle = createPtyHandle(message.sessionId)
        const session = this.getOrCreateSession(message.sessionId, message.processName)
        session.processName = message.processName
        pending.resolve({ ok: true, handle, processName: message.processName })
      } else {
        pending.resolve({ ok: false, message: message.error })
      }
      return
    }
    if (message.type === 'pty-data') {
      const session = this.sessions.get(message.sessionId)
      if (!session) return
      for (const listener of Array.from(session.listeners.data)) listener(message.data)
      return
    }
    if (message.type === 'pty-process-name-changed') {
      const session = this.sessions.get(message.sessionId)
      if (!session) return
      session.processName = message.processName
      return
    }
    if (message.type === 'pty-exit') {
      const session = this.sessions.get(message.sessionId)
      if (!session) return
      for (const listener of Array.from(session.listeners.exit)) listener(message.code, message.signal)
      this.sessions.delete(message.sessionId)
    }
  }

  private failPendingSpawns(error: Error | string): void {
    const message = error instanceof Error ? error.message : error
    for (const pending of Array.from(this.pendingSpawns.values())) {
      pending.resolve({ ok: false, message })
    }
    this.pendingSpawns.clear()
  }

  private failSessionListenersOnWorkerExit(): void {
    for (const session of Array.from(this.sessions.values())) {
      for (const listener of Array.from(session.listeners.exit)) listener(null, null)
    }
    this.sessions.clear()
  }

  private scheduleRestart(): void {
    if (this.restartTimer || this.worker || this.shuttingDown) return
    const delayMs = this.restartBackoffMs()
    ptyWorkerLogger.info(
      { delayMs, restartAttempts: this.restartAttempts, sessions: this.sessions.size, lastFailure: this.lastFailure },
      'scheduling PTY worker restart',
    )
    this.restartTimer = (this.options.setTimer ?? setTimeout)(() => {
      this.restartTimer = null
      if (this.shuttingDown || this.worker) return
      try {
        this.ensureWorker()
      } catch (error) {
        ptyWorkerLogger.error({ err: error, lastFailure: this.lastFailure }, 'failed to restart PTY worker')
        if (this.sessions.size > 0) this.scheduleRestart()
      }
    }, delayMs)
  }

  private clearRestartTimer(): void {
    if (!this.restartTimer) return
    ;(this.options.clearTimer ?? clearTimeout)(this.restartTimer)
    this.restartTimer = null
  }

  private restartBackoffMs(): number {
    return Math.min(MIN_RESTART_BACKOFF_MS * 2 ** Math.max(0, this.restartAttempts - 1), MAX_RESTART_BACKOFF_MS)
  }

  private getOrCreateSession(sessionId: string, defaultProcessName: string) {
    let session = this.sessions.get(sessionId)
    if (!session) {
      session = { processName: defaultProcessName, listeners: { data: new Set(), exit: new Set() } }
      this.sessions.set(sessionId, session)
    }
    return session
  }

  private recordFailure(kind: PtySupervisorFailureDiagnostics['kind'], detail: string): void {
    this.lastFailure = { kind, at: this.now(), detail }
  }

  private unavailableMessage(): string {
    if (!this.lastFailure) return 'PTY worker unavailable'
    return `PTY worker unavailable (${this.lastFailure.kind}: ${this.lastFailure.detail})`
  }

  private now(): number {
    return (this.options.now ?? Date.now)()
  }

  private currentState(): PtySupervisorDiagnostics['state'] {
    if (this.shuttingDown) return 'shutting-down'
    if (this.worker) return 'running'
    if (this.restartTimer) return 'restarting'
    return 'idle'
  }

  private resolveWorkerEntry(): string {
    if (this.options.workerEntry) return this.options.workerEntry
    if (this.options.workerEntryDir) {
      return resolvePtyWorkerEntry(this.options.workerEntryDir, this.options.fileExists)
    }
    throw new Error('PTY worker entry or entry dir is required')
  }
}

function defaultSpawnWorker(entry: string): TerminalWorkerChildProcess {
  return spawn(process.execPath, [entry], {
    env: process.env,
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  }) as TerminalWorkerChildProcess
}

function createRequestId(): string {
  return `req_${crypto.randomUUID()}`
}
