// Main-side IPC bridge to the PTY worker subprocess. Implements the
// `PtySupervisor` interface by translating high-level supervisor calls
// into the small PTY-only wire protocol. The worker is spawned lazily on
// first use. A crash terminates every PTY owned by that process, so a future
// spawn request creates the next worker instead of prestarting an empty one.

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { serverLogger } from '#/server/logger.ts'
import {
  createPtyHandle,
  type PtyHandle,
  type PtySpawnInput,
  type PtySpawnResult,
  type PtySupervisor,
} from '#/server/terminal/pty-supervisor.ts'
import { createPtyEventChannel, type PtyEventChannel } from '#/server/terminal/pty-event-lease.ts'
import { StickyCompletion } from '#/server/terminal/sticky-completion.ts'
import { normalizePtyWorkerMessage, type PtyWorkerMessage } from '#/server/terminal/pty-worker-protocol.ts'
import type { PtySupervisorDiagnostics, PtySupervisorFailureDiagnostics } from '#/server/terminal/terminal-host.ts'
import { createOpaqueId } from '#/shared/opaque-id.ts'
import { resolvePtyWorkerEntry } from '#/server/terminal/pty-worker-entry.ts'
import type { TerminalWriteResult } from '#/shared/terminal-types.ts'

const DEFAULT_SPAWN_ACK_TIMEOUT_MS = 10_000
const DEFAULT_WRITE_ACK_TIMEOUT_MS = 5_000
const DEFAULT_RESIZE_ACK_TIMEOUT_MS = 5_000
const MAX_PENDING_WRITE_ACKS = 1_024
const MAX_PENDING_RESIZE_ACKS = 1_024
const DEFAULT_MAX_PENDING_WRITE_BYTES = 8 * 1024 * 1024
const ptyWorkerLogger = serverLogger.child({ module: 'pty-supervisor-worker' })

type TerminalWorkerChildProcess = ChildProcess
type WorkerInvalidationKind = Extract<
  PtySupervisorFailureDiagnostics['kind'],
  'exit' | 'error' | 'disconnect' | 'protocol' | 'timeout' | 'send-failed'
>

interface PendingSpawn {
  input: PtySpawnInput
  handle: PtyHandle
  ownership: PtyEventOwnership
  resolve(value: PtySpawnResult): void
  timeout: ReturnType<typeof setTimeout> | null
}

interface PendingWrite {
  ptySessionId: string
  byteLength: number
  resolve(value: TerminalWriteResult): void
  timeout: ReturnType<typeof setTimeout>
}

interface PendingResize {
  ptySessionId: string
  resolve(accepted: boolean): void
  timeout: ReturnType<typeof setTimeout>
}

interface PtyEventOwnership {
  processName: string
  channel: PtyEventChannel
  exitCompletion: StickyCompletion
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
  spawnAckTimeoutMs?: number
  writeAckTimeoutMs?: number
  resizeAckTimeoutMs?: number
  maxPendingWriteBytes?: number
}

export class WorkerBackedPtySupervisor implements PtySupervisor {
  readonly mode = 'worker-backed' as const
  private readonly options: WorkerBackedPtySupervisorOptions
  private worker: TerminalWorkerChildProcess | null = null
  private workerStartedAt = 0
  private readonly pendingSpawns = new Map<string, PendingSpawn>()
  private readonly pendingSpawnsByPtySessionId = new Map<string, PendingSpawn>()
  private readonly pendingWrites = new Map<string, PendingWrite>()
  private readonly pendingResizes = new Map<string, PendingResize>()
  private pendingWriteBytes = 0
  private readonly sessions = new Map<string, PtyEventOwnership>()
  private consecutiveWorkerInvalidations = 0
  private shuttingDown = false
  private lastSuccessfulResponseAt: number | null = null
  private lastExitCode: number | null = null
  private lastExitSignal: NodeJS.Signals | null = null
  private lastFailure: PtySupervisorFailureDiagnostics | null = null

  constructor(options: WorkerBackedPtySupervisorOptions = {}) {
    this.options = options
  }

  async spawn(input: PtySpawnInput): Promise<PtySpawnResult> {
    if (this.shuttingDown) return { ok: false, message: 'PTY worker stopped' }
    const requestId = createRequestId()
    const handle = createPtyHandle(createPtySessionId())
    const ownership: PtyEventOwnership = {
      processName: 'terminal',
      channel: createPtyEventChannel(),
      exitCompletion: new StickyCompletion(),
    }
    return await new Promise<PtySpawnResult>((resolve) => {
      const pending: PendingSpawn = { input, handle, ownership, resolve, timeout: null }
      this.pendingSpawns.set(requestId, pending)
      this.pendingSpawnsByPtySessionId.set(handle.ptySessionId, pending)
      this.sendSpawnRequest(requestId, pending)
    })
  }

  async write(handle: PtyHandle, data: string): Promise<TerminalWriteResult> {
    if (this.shuttingDown || !this.sessions.has(handle.ptySessionId)) return { status: 'rejected' }
    if (this.pendingWrites.size >= MAX_PENDING_WRITE_ACKS) return { status: 'rejected' }
    const byteLength = Buffer.byteLength(data, 'utf8')
    if (this.pendingWriteBytes + byteLength > (this.options.maxPendingWriteBytes ?? DEFAULT_MAX_PENDING_WRITE_BYTES)) {
      return { status: 'rejected' }
    }
    const worker = this.worker
    if (!worker) return { status: 'rejected' }
    const requestId = createRequestId()
    return await new Promise<TerminalWriteResult>((resolve) => {
      const timeoutMs = this.options.writeAckTimeoutMs ?? DEFAULT_WRITE_ACK_TIMEOUT_MS
      const timeout = setTimeout(() => {
        if (!this.pendingWrites.has(requestId)) return
        this.invalidateWorker(
          worker,
          'timeout',
          `action=pty-write ptySessionId=${handle.ptySessionId} timeoutMs=${timeoutMs}`,
          'PTY worker write timed out',
        )
      }, timeoutMs)
      this.pendingWrites.set(requestId, { ptySessionId: handle.ptySessionId, byteLength, resolve, timeout })
      this.pendingWriteBytes += byteLength
      try {
        // `false` signals IPC backpressure, not rejection. The worker result is authoritative.
        worker.send({ type: 'pty-write', requestId, ptySessionId: handle.ptySessionId, data }, (error) => {
          if (!error) return
          this.settlePendingWrite(requestId, { status: 'rejected' })
          this.invalidateWorkerAfterSendFailure(worker, `action=pty-write ptySessionId=${handle.ptySessionId}`)
        })
      } catch {
        this.settlePendingWrite(requestId, { status: 'rejected' })
        this.invalidateWorkerAfterSendFailure(worker, `action=pty-write ptySessionId=${handle.ptySessionId}`)
      }
    })
  }

  async resize(handle: PtyHandle, cols: number, rows: number): Promise<boolean> {
    if (this.shuttingDown || !this.sessions.has(handle.ptySessionId)) return false
    if (this.pendingResizes.size >= MAX_PENDING_RESIZE_ACKS) return false
    const worker = this.worker
    if (!worker) return false
    const requestId = createRequestId()
    return await new Promise<boolean>((resolve) => {
      const timeoutMs = this.options.resizeAckTimeoutMs ?? DEFAULT_RESIZE_ACK_TIMEOUT_MS
      const timeout = setTimeout(() => {
        if (!this.pendingResizes.has(requestId)) return
        this.invalidateWorker(
          worker,
          'timeout',
          `action=pty-resize ptySessionId=${handle.ptySessionId} timeoutMs=${timeoutMs}`,
          'PTY worker resize timed out',
        )
      }, timeoutMs)
      this.pendingResizes.set(requestId, { ptySessionId: handle.ptySessionId, resolve, timeout })
      try {
        worker.send({ type: 'pty-resize', requestId, ptySessionId: handle.ptySessionId, cols, rows }, (error) => {
          if (!error) return
          this.settlePendingResize(requestId, false)
          this.invalidateWorkerAfterSendFailure(worker, `action=pty-resize ptySessionId=${handle.ptySessionId}`)
        })
      } catch {
        this.settlePendingResize(requestId, false)
        this.invalidateWorkerAfterSendFailure(worker, `action=pty-resize ptySessionId=${handle.ptySessionId}`)
      }
    })
  }

  kill(handle: PtyHandle): void {
    if (this.shuttingDown) return
    if (!this.sessions.has(handle.ptySessionId)) return
    const worker = this.worker
    if (!worker) return
    this.sendKillRequest(worker, handle.ptySessionId)
  }

  async waitForExit(handle: PtyHandle): Promise<void> {
    const ownership = this.eventOwnership(handle.ptySessionId)
    if (!ownership) return
    await ownership.exitCompletion.waitUntilCompleted()
  }

  async killAndWait(handle: PtyHandle): Promise<void> {
    if (this.shuttingDown) return
    const ownership = this.eventOwnership(handle.ptySessionId)
    if (!ownership || ownership.exitCompletion.completed) return
    const worker = this.worker
    if (!worker) return
    this.sendKillRequest(worker, handle.ptySessionId)
    await ownership.exitCompletion.wait(5_000, 'PTY close timed out')
  }

  getDiagnostics(): PtySupervisorDiagnostics {
    return {
      mode: 'worker-backed',
      state: this.currentState(),
      workerRunning: this.worker !== null,
      workerPid: this.worker?.pid ?? null,
      workerStartedAt: this.worker ? this.workerStartedAt : null,
      workerUptimeMs: this.worker ? Math.max(0, this.now() - this.workerStartedAt) : null,
      pendingRequests: this.pendingSpawns.size + this.pendingWrites.size + this.pendingResizes.size,
      consecutiveWorkerInvalidations: this.consecutiveWorkerInvalidations,
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
    const worker = this.worker
    this.worker = null
    this.failPendingSpawns('PTY worker stopped')
    this.settlePendingWrites({ status: 'indeterminate' })
    this.settlePendingResizes(false)
    // Drop all event ownership — the runtime that owns us has already
    // called ptySupervisor.shutdown and is closing its own sessions.
    for (const ownership of this.sessions.values()) {
      ownership.channel.lease.dispose()
      ownership.exitCompletion.complete()
    }
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
    if (this.worker) return this.worker
    const entry = this.resolveWorkerEntry()
    const worker = this.options.spawnWorker ? this.options.spawnWorker(entry) : defaultSpawnWorker(entry)
    this.workerStartedAt = this.now()
    ptyWorkerLogger.info(
      {
        pid: worker.pid,
        consecutiveWorkerInvalidations: this.consecutiveWorkerInvalidations,
        sessions: this.sessions.size,
      },
      'spawned PTY worker',
    )
    worker.on('message', (raw) => {
      if (this.worker !== worker) return
      const message = normalizePtyWorkerMessage(raw)
      if (!message) {
        this.invalidateWorker(worker, 'protocol', 'malformed worker message', 'PTY worker protocol violation')
        return
      }
      this.handleWorkerMessage(worker, message)
    })
    worker.once('exit', (code, signal) => {
      const uptimeMs = Math.max(0, this.now() - this.workerStartedAt)
      this.invalidateWorker(
        worker,
        'exit',
        `code=${code ?? 'null'} signal=${signal ?? 'null'} uptimeMs=${uptimeMs}`,
        'PTY worker exited',
        { code: code ?? null, signal: signal ?? null },
      )
    })
    worker.once('error', (error) => {
      const message = error instanceof Error ? error.message : String(error)
      this.invalidateWorker(worker, 'error', message, message)
    })
    worker.once('disconnect', () => {
      this.invalidateWorker(worker, 'disconnect', 'parent IPC channel closed', 'PTY worker disconnected')
    })
    this.worker = worker
    return worker
  }

  private handleWorkerMessage(worker: TerminalWorkerChildProcess, message: PtyWorkerMessage): void {
    if (message.type === 'pty-resize-result') {
      if (this.settlePendingResize(message.requestId, message.accepted)) this.lastSuccessfulResponseAt = this.now()
      return
    }
    if (message.type === 'pty-write-result') {
      if (!this.settlePendingWrite(message.requestId, { status: message.status })) return
      this.lastSuccessfulResponseAt = this.now()
      return
    }
    if (message.type === 'pty-spawn-result') {
      const pending = this.pendingSpawns.get(message.requestId)
      if (!pending) return
      if (message.ok) {
        if (message.ptySessionId !== pending.handle.ptySessionId) {
          this.invalidateWorker(
            worker,
            'protocol',
            `action=pty-spawn expected=${pending.handle.ptySessionId} received=${message.ptySessionId}`,
            'PTY worker protocol violation',
          )
          return
        }
        const settled = this.takePendingSpawn(message.requestId)
        if (!settled) return
        this.lastSuccessfulResponseAt = this.now()
        this.consecutiveWorkerInvalidations = 0
        if (message.processName !== 'terminal' || settled.ownership.processName === 'terminal') {
          settled.ownership.processName = message.processName
        }
        const processName = settled.ownership.processName
        if (!settled.ownership.exitCompletion.completed) this.sessions.set(message.ptySessionId, settled.ownership)
        settled.resolve({
          ok: true,
          handle: settled.handle,
          processName,
          events: settled.ownership.channel.lease,
        })
      } else {
        const settled = this.takePendingSpawn(message.requestId)
        if (!settled) return
        this.disposePendingSpawnOwnership(settled)
        settled.resolve({ ok: false, message: message.error })
        if (message.failure.recoverable && this.sessions.size === 0) {
          this.recordFailure('spawn-failed', message.error)
          ptyWorkerLogger.warn(
            { err: message.error, pendingRequests: this.pendingSpawns.size },
            'retiring idle PTY worker after recoverable spawn failure',
          )
          // A worker-level recovery must never reuse a candidate handle or its
          // event lease: either may already own buffered output or a completed
          // exit. Fail every candidate owned by this worker. A later explicit
          // attach/restart creates a new handle, lease, and worker transaction.
          this.failPendingSpawns(message.error)
          this.recycleIdleWorker()
        }
      }
      return
    }
    if (message.type === 'pty-data') {
      const ownership = this.eventOwnership(message.ptySessionId)
      if (ownership) ownership.channel.sink.data({ data: message.data, processName: ownership.processName })
      return
    }
    if (message.type === 'pty-process-name-changed') {
      const ownership = this.eventOwnership(message.ptySessionId)
      if (ownership) ownership.processName = message.processName
      return
    }
    if (message.type === 'pty-exit') {
      const ownership = this.eventOwnership(message.ptySessionId)
      if (!ownership) return
      this.settlePendingWritesForPty(message.ptySessionId, { status: 'indeterminate' })
      this.settlePendingResizesForPty(message.ptySessionId, false)
      ownership.exitCompletion.complete()
      this.sessions.delete(message.ptySessionId)
      ownership.channel.sink.exit(message.code, message.signal)
    }
  }

  private settlePendingWritesForPty(ptySessionId: string, result: TerminalWriteResult): void {
    for (const [requestId, pending] of this.pendingWrites) {
      if (pending.ptySessionId !== ptySessionId) continue
      this.settlePendingWrite(requestId, result)
    }
  }

  private settlePendingResizesForPty(ptySessionId: string, accepted: boolean): void {
    for (const [requestId, pending] of this.pendingResizes) {
      if (pending.ptySessionId === ptySessionId) this.settlePendingResize(requestId, accepted)
    }
  }

  private settlePendingResizes(accepted: boolean): void {
    for (const requestId of Array.from(this.pendingResizes.keys())) this.settlePendingResize(requestId, accepted)
  }

  private settlePendingResize(requestId: string, accepted: boolean): boolean {
    const pending = this.pendingResizes.get(requestId)
    if (!pending) return false
    this.pendingResizes.delete(requestId)
    clearTimeout(pending.timeout)
    pending.resolve(accepted)
    return true
  }

  private settlePendingWrites(result: TerminalWriteResult): void {
    for (const requestId of Array.from(this.pendingWrites.keys())) this.settlePendingWrite(requestId, result)
  }

  private settlePendingWrite(requestId: string, result: TerminalWriteResult): boolean {
    const pending = this.pendingWrites.get(requestId)
    if (!pending) return false
    this.pendingWrites.delete(requestId)
    this.pendingWriteBytes -= pending.byteLength
    clearTimeout(pending.timeout)
    pending.resolve(result)
    return true
  }

  private failPendingSpawns(error: Error | string): void {
    const message = error instanceof Error ? error.message : error
    for (const requestId of Array.from(this.pendingSpawns.keys())) {
      const pending = this.takePendingSpawn(requestId)
      if (!pending) continue
      this.disposePendingSpawnOwnership(pending)
      pending.resolve({ ok: false, message })
    }
  }

  private sendSpawnRequest(requestId: string, pending: PendingSpawn): void {
    let worker: TerminalWorkerChildProcess
    try {
      worker = this.ensureWorker()
    } catch {
      if (!this.takePendingSpawn(requestId)) return
      this.disposePendingSpawnOwnership(pending)
      this.recordFailure('send-failed', 'action=pty-spawn')
      pending.resolve({ ok: false, message: this.unavailableMessage() })
      return
    }
    const timeoutMs = this.options.spawnAckTimeoutMs ?? DEFAULT_SPAWN_ACK_TIMEOUT_MS
    pending.timeout = setTimeout(() => {
      if (this.pendingSpawns.get(requestId) !== pending) return
      this.invalidateWorker(
        worker,
        'timeout',
        `action=pty-spawn ptySessionId=${pending.handle.ptySessionId} timeoutMs=${timeoutMs}`,
        'PTY worker spawn timed out',
      )
    }, timeoutMs)
    try {
      // ChildProcess.send() returning false only reports IPC backpressure.
      // A callback error proves the transport did not deliver the request, so
      // every session and pending request owned by that worker becomes invalid.
      worker.send(
        {
          type: 'pty-spawn',
          requestId,
          ptySessionId: pending.handle.ptySessionId,
          input: pending.input,
        },
        (error) => {
          if (!error) return
          this.invalidateWorkerAfterSendFailure(worker, 'action=pty-spawn')
        },
      )
    } catch {
      this.invalidateWorkerAfterSendFailure(worker, 'action=pty-spawn')
    }
  }

  private recycleIdleWorker(): void {
    if (this.sessions.size > 0) return
    const worker = this.worker
    this.worker = null
    if (!worker) return
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

  private invalidateWorkerAfterSendFailure(worker: TerminalWorkerChildProcess, detail: string): void {
    this.invalidateWorker(worker, 'send-failed', detail, `PTY worker unavailable (send-failed: ${detail})`)
  }

  private sendKillRequest(worker: TerminalWorkerChildProcess, ptySessionId: string): void {
    try {
      worker.send({ type: 'pty-kill', ptySessionId }, (error) => {
        if (error) this.invalidateWorkerAfterSendFailure(worker, `action=pty-kill ptySessionId=${ptySessionId}`)
      })
    } catch {
      this.invalidateWorkerAfterSendFailure(worker, `action=pty-kill ptySessionId=${ptySessionId}`)
    }
  }

  private invalidateWorker(
    worker: TerminalWorkerChildProcess,
    kind: WorkerInvalidationKind,
    detail: string,
    pendingSpawnMessage: string,
    exit: { code: number | null; signal: NodeJS.Signals | null } | null = null,
  ): void {
    if (this.worker !== worker) return
    this.worker = null
    if (exit) {
      this.lastExitCode = exit.code
      this.lastExitSignal = exit.signal
    }
    this.recordFailure(kind, detail)
    this.consecutiveWorkerInvalidations += 1
    ptyWorkerLogger.warn(
      {
        pid: worker.pid,
        kind,
        detail,
        consecutiveWorkerInvalidations: this.consecutiveWorkerInvalidations,
        sessions: this.sessions.size,
      },
      'PTY worker transport lost',
    )
    this.failPendingSpawns(pendingSpawnMessage)
    this.settlePendingWrites({ status: 'indeterminate' })
    this.settlePendingResizes(false)
    this.failSessionListenersOnWorkerExit()
    if (kind !== 'exit') {
      try {
        worker.kill()
      } catch {}
    }
  }

  private failSessionListenersOnWorkerExit(): void {
    for (const ownership of Array.from(this.sessions.values())) {
      ownership.exitCompletion.complete()
      ownership.channel.sink.exit(null, null)
    }
    this.sessions.clear()
  }

  private eventOwnership(ptySessionId: string): PtyEventOwnership | null {
    return this.sessions.get(ptySessionId) ?? this.pendingSpawnsByPtySessionId.get(ptySessionId)?.ownership ?? null
  }

  private takePendingSpawn(requestId: string): PendingSpawn | null {
    const pending = this.pendingSpawns.get(requestId)
    if (!pending) return null
    this.pendingSpawns.delete(requestId)
    if (this.pendingSpawnsByPtySessionId.get(pending.handle.ptySessionId) === pending) {
      this.pendingSpawnsByPtySessionId.delete(pending.handle.ptySessionId)
    }
    if (pending.timeout !== null) clearTimeout(pending.timeout)
    pending.timeout = null
    return pending
  }

  private disposePendingSpawnOwnership(pending: PendingSpawn): void {
    pending.ownership.channel.lease.dispose()
    pending.ownership.exitCompletion.complete()
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
  return createOpaqueId('req')
}

function createPtySessionId(): string {
  return createOpaqueId('pty')
}
