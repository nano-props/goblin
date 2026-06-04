import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type {
  TerminalAttachInput,
  TerminalAttachResult,
  TerminalCatalogMutationResult,
  TerminalCreateInput,
  TerminalMutationResult,
  TerminalNotifyBellInput,
  TerminalResizeInput,
  TerminalRestartInput,
  TerminalSessionInput,
  TerminalSessionSnapshot,
  TerminalSessionSnapshotInput,
  TerminalSessionSummary,
  TerminalTakeoverInput,
  TerminalTakeoverResult,
  TerminalWriteInput,
} from '#/shared/terminal.ts'
import type {
  ServerTerminalHostDiagnostics,
  ServerTerminalHost,
  ServerTerminalSocket,
} from '#/server/terminal/terminal-host.ts'
import type { TerminalWorkerMessage, TerminalWorkerRequest } from '#/server/terminal/terminal-worker-protocol.ts'
import { isValidTerminalAttachmentId } from '#/shared/terminal.ts'
import { serverLogger } from '#/server/logger.ts'

interface PendingRequest<T> {
  resolve(value: T): void
  reject(error: Error): void
}

type WorkerTimerHandle = ReturnType<typeof setTimeout> | number
type TerminalWorkerChildProcess = ChildProcess & {
  send?(message: TerminalWorkerRequest): boolean
}

export interface WorkerBackedTerminalHostOptions {
  spawnWorker?: () => TerminalWorkerChildProcess
  now?: () => number
  setTimer?: (callback: () => void, delayMs: number) => WorkerTimerHandle
  clearTimer?: (timer: WorkerTimerHandle) => void
}

const TERMINAL_CLIENT_ID_RE = /^[A-Za-z0-9_-]{1,128}$/
const STABLE_WORKER_UPTIME_MS = 15_000
const MIN_RESTART_BACKOFF_MS = 250
const MAX_RESTART_BACKOFF_MS = 5_000
const terminalWorkerLogger = serverLogger.child({ module: 'terminal-worker-host' })

function isValidTerminalClientId(value: unknown): value is string {
  return typeof value === 'string' && TERMINAL_CLIENT_ID_RE.test(value)
}

function resolveTerminalWorkerEntry(): string {
  const built = path.resolve(import.meta.dirname, 'terminal', 'terminal-worker.js')
  if (existsSync(built)) return built
  return path.resolve(import.meta.dirname, 'terminal-worker.ts')
}

function defaultSpawnWorker(): TerminalWorkerChildProcess {
  return spawn(process.execPath, [resolveTerminalWorkerEntry()], {
    env: process.env,
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  })
}

export class WorkerBackedTerminalHost implements ServerTerminalHost {
  private worker: TerminalWorkerChildProcess | null = null
  private readonly pending = new Map<string, PendingRequest<unknown>>()
  private readonly sockets = new Map<string, ServerTerminalSocket>()
  private readonly socketMeta = new Map<string, { clientId: string; attachmentId: string }>()
  private restartAttempts = 0
  private workerStartedAt = 0
  private restartTimer: WorkerTimerHandle | null = null
  private shuttingDown = false
  private lastSuccessfulResponseAt: number | null = null
  private lastExitCode: number | null = null
  private lastExitSignal: NodeJS.Signals | null = null
  private lastWorkerFailure: { kind: 'exit' | 'error' | 'send-failed'; at: number; detail: string } | null = null

  constructor(private readonly options: WorkerBackedTerminalHostOptions = {}) {}

  isValidClientId(value: unknown): value is string {
    return isValidTerminalClientId(value)
  }

  getDiagnostics(): ServerTerminalHostDiagnostics {
    return {
      mode: 'worker-backed',
      state: this.currentState(),
      workerRunning: this.worker !== null,
      workerPid: this.worker?.pid ?? null,
      workerStartedAt: this.worker ? this.workerStartedAt : null,
      workerUptimeMs: this.worker ? Math.max(0, this.now() - this.workerStartedAt) : null,
      pendingRequests: this.pending.size,
      registeredSockets: this.socketMeta.size,
      restartAttempts: this.restartAttempts,
      restartScheduled: this.restartTimer !== null,
      shuttingDown: this.shuttingDown,
      lastSuccessfulResponseAt: this.lastSuccessfulResponseAt,
      lastExitCode: this.lastExitCode,
      lastExitSignal: this.lastExitSignal,
      lastWorkerFailure: this.lastWorkerFailure,
    }
  }

  registerSocket(clientId: string, attachmentId: string, socket: ServerTerminalSocket): void {
    if (!this.isValidClientId(clientId) || !isValidTerminalAttachmentId(attachmentId)) {
      socket.close(1008, 'invalid client id')
      return
    }
    const worker = this.ensureWorker()
    const socketId = createSocketId()
    this.sockets.set(socketId, socket)
    this.socketMeta.set(socketId, { clientId, attachmentId })
    worker.send?.({ type: 'socket-register', socketId, clientId, attachmentId })
  }

  unregisterSocket(clientId: string, attachmentId: string, socket: ServerTerminalSocket): void {
    const entry = Array.from(this.sockets.entries()).find(
      ([socketId, value]) =>
        value === socket &&
        this.socketMeta.get(socketId)?.clientId === clientId &&
        this.socketMeta.get(socketId)?.attachmentId === attachmentId,
    )
    if (!entry) return
    const [socketId] = entry
    this.sockets.delete(socketId)
    this.socketMeta.delete(socketId)
    this.worker?.send?.({ type: 'socket-unregister', socketId, clientId, attachmentId })
  }

  attach(clientId: string, input: TerminalAttachInput): Promise<TerminalAttachResult> {
    return this.request('attach', clientId, input)
  }

  restart(clientId: string, input: TerminalRestartInput): Promise<TerminalAttachResult> {
    return this.request('restart', clientId, input)
  }

  write(clientId: string, input: TerminalWriteInput): Promise<TerminalMutationResult> {
    return this.request('write', clientId, input)
  }

  resize(clientId: string, input: TerminalResizeInput): Promise<TerminalMutationResult> {
    return this.request('resize', clientId, input)
  }

  takeover(clientId: string, input: TerminalTakeoverInput): Promise<TerminalTakeoverResult> {
    return this.request('takeover', clientId, input)
  }

  close(clientId: string, input: TerminalSessionInput): Promise<TerminalMutationResult> {
    return this.request('close', clientId, input)
  }

  notifyBell(clientId: string, input: TerminalNotifyBellInput): Promise<TerminalMutationResult> {
    return this.request('notify-bell', clientId, input)
  }

  listSessions(clientId: string, repoRoot: string): Promise<TerminalSessionSummary[]> {
    return this.request('list-sessions', clientId, { repoRoot })
  }

  create(clientId: string, input: TerminalCreateInput): Promise<TerminalCatalogMutationResult> {
    return this.request('create', clientId, input)
  }

  prune(clientId: string, repoRoot: string): Promise<{ pruned: number; remaining: number }> {
    return this.request('prune', clientId, { repoRoot })
  }

  getSessionSnapshot(clientId: string, input: TerminalSessionSnapshotInput): Promise<TerminalSessionSnapshot | null> {
    return this.request('session-snapshot', clientId, input)
  }

  shutdown(): void {
    this.shuttingDown = true
    this.clearRestartTimer()
    const worker = this.worker
    this.worker = null
    terminalWorkerLogger.info(
      { pid: worker?.pid, pendingRequests: this.pending.size, sockets: this.socketMeta.size },
      'shutting down terminal worker host',
    )
    for (const pending of this.pending.values()) pending.reject(new Error('Terminal worker stopped'))
    this.pending.clear()
    this.socketMeta.clear()
    this.sockets.clear()
    worker?.send?.({ type: 'shutdown' })
    try {
      worker?.disconnect?.()
    } catch {}
    try {
      worker?.kill()
    } catch {}
  }

  private request<T>(
    action: Extract<TerminalWorkerRequest, { type: 'request' }>['action'],
    clientId: string,
    input: Extract<TerminalWorkerRequest, { type: 'request' }>['input'],
  ): Promise<T> {
    const worker = this.ensureWorker()
    const requestId = crypto.randomUUID()
    return awaitable<T>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject })
      const sent = worker.send?.({ type: 'request', requestId, action, clientId, input }) ?? false
      if (!sent) {
        this.pending.delete(requestId)
        this.lastWorkerFailure = {
          kind: 'send-failed',
          at: this.now(),
          detail: `action=${action}`,
        }
        terminalWorkerLogger.warn(
          {
            pid: worker.pid,
            action,
            clientId,
            requestId,
            pendingRequests: this.pending.size,
            lastWorkerFailure: this.lastWorkerFailure,
          },
          'failed to send terminal worker request',
        )
        reject(new Error(this.unavailableMessage()))
      }
    })
  }

  private ensureWorker(): TerminalWorkerChildProcess {
    this.clearRestartTimer()
    if (this.worker) return this.worker
    const worker = (this.options.spawnWorker ?? defaultSpawnWorker)()
    this.workerStartedAt = this.now()
    terminalWorkerLogger.info(
      { pid: worker.pid, restartAttempts: this.restartAttempts, sockets: this.socketMeta.size },
      'spawned terminal worker',
    )
    worker.on('message', (message) => {
      this.handleWorkerMessage(message as TerminalWorkerMessage)
    })
    worker.once('exit', (code, signal) => {
      if (this.worker === worker) this.worker = null
      const uptimeMs = Math.max(0, this.now() - this.workerStartedAt)
      this.lastExitCode = code ?? null
      this.lastExitSignal = signal ?? null
      this.lastWorkerFailure = {
        kind: 'exit',
        at: this.now(),
        detail: `code=${code ?? 'null'} signal=${signal ?? 'null'} uptimeMs=${uptimeMs}`,
      }
      if (uptimeMs >= STABLE_WORKER_UPTIME_MS) this.restartAttempts = 0
      else this.restartAttempts += 1
      if (!this.shuttingDown) {
        terminalWorkerLogger.warn(
          {
            pid: worker.pid,
            code,
            signal,
            uptimeMs,
            restartAttempts: this.restartAttempts,
            pendingRequests: this.pending.size,
            sockets: this.socketMeta.size,
          },
          'terminal worker exited',
        )
      }
      for (const pending of this.pending.values()) pending.reject(new Error('Terminal worker exited'))
      this.pending.clear()
      if (!this.shuttingDown && this.socketMeta.size > 0) this.scheduleRestart()
    })
    worker.once('error', (error) => {
      this.lastWorkerFailure = {
        kind: 'error',
        at: this.now(),
        detail: error instanceof Error ? error.message : String(error),
      }
      terminalWorkerLogger.error(
        { err: error, pid: worker.pid, pendingRequests: this.pending.size, sockets: this.socketMeta.size },
        'terminal worker process error',
      )
      if (this.worker === worker) this.worker = null
      for (const pending of this.pending.values()) pending.reject(error instanceof Error ? error : new Error(String(error)))
      this.pending.clear()
      if (!this.shuttingDown && this.socketMeta.size > 0) this.scheduleRestart()
    })
    this.worker = worker
    for (const [socketId, meta] of this.socketMeta.entries()) {
      worker.send?.({ type: 'socket-register', socketId, clientId: meta.clientId, attachmentId: meta.attachmentId })
    }
    return worker
  }

  private handleWorkerMessage(message: TerminalWorkerMessage): void {
    if (message.type === 'response') {
      const pending = this.pending.get(message.requestId)
      if (!pending) return
      this.pending.delete(message.requestId)
      if (message.ok) {
        this.restartAttempts = 0
        this.lastSuccessfulResponseAt = this.now()
        pending.resolve(message.payload)
      }
      else pending.reject(new Error(message.error))
      return
    }
    if (message.type === 'socket-send') {
      this.sockets.get(message.socketId)?.send(message.payload)
      return
    }
    if (message.type === 'socket-close') {
      this.sockets.get(message.socketId)?.close(message.code, message.reason)
    }
  }

  private scheduleRestart(): void {
    if (this.restartTimer || this.worker || this.shuttingDown) return
    const delayMs = this.restartBackoffMs()
    terminalWorkerLogger.info(
      {
        delayMs,
        restartAttempts: this.restartAttempts,
        sockets: this.socketMeta.size,
        lastWorkerFailure: this.lastWorkerFailure,
      },
      'scheduling terminal worker restart',
    )
    this.restartTimer = (this.options.setTimer ?? setTimeout)(() => {
      this.restartTimer = null
      if (this.shuttingDown || this.worker) return
      try {
        this.ensureWorker()
      } catch (error) {
        terminalWorkerLogger.error({ err: error, lastWorkerFailure: this.lastWorkerFailure }, 'failed to restart terminal worker')
        if (this.socketMeta.size > 0) this.scheduleRestart()
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

  private now(): number {
    return (this.options.now ?? Date.now)()
  }

  private currentState(): ServerTerminalHostDiagnostics['state'] {
    if (this.shuttingDown) return 'shutting-down'
    if (this.worker) return 'running'
    if (this.restartTimer) return 'restarting'
    return 'idle'
  }

  private unavailableMessage(): string {
    if (!this.lastWorkerFailure) return 'Terminal worker unavailable'
    return `Terminal worker unavailable (${this.lastWorkerFailure.kind}: ${this.lastWorkerFailure.detail})`
  }
}

function createSocketId(): string {
  return `term_socket_${crypto.randomUUID()}`
}

function awaitable<T>(run: (resolve: (value: T) => void, reject: (error: Error) => void) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    run(resolve, reject)
  })
}
