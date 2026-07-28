import { EventEmitter } from 'node:events'
import { WorkerBackedPtySupervisor } from '#/server/terminal/pty-supervisor-worker.ts'
import type { PtyWorkerMessage } from '#/server/terminal/pty-worker-protocol.ts'

export class FakeWorker extends EventEmitter {
  sent: unknown[] = []
  killed = false
  sendResult = true
  sendError: Error | null = null
  sendCallbackError: Error | null = null
  pid = 4242

  send(message: unknown, callback?: (error: Error | null) => void): boolean {
    if (this.sendError) throw this.sendError
    this.sent.push(message)
    if (callback) {
      const callbackError = this.sendCallbackError
      queueMicrotask(() => callback(callbackError))
    }
    return this.sendResult
  }

  kill(): void {
    this.killed = true
  }

  disconnect(): void {}
}

export interface SpawnRequest {
  type: 'pty-spawn'
  requestId: string
  ptySessionId: string
  input: { cwd: string; cols: number; rows: number }
}

export async function spawnSession(supervisor: WorkerBackedPtySupervisor, worker: FakeWorker) {
  const spawn = supervisor.spawn({ cwd: '/repo', cols: 80, rows: 24 })
  const request = worker.sent.at(-1) as SpawnRequest
  worker.emit('message', {
    type: 'pty-spawn-result',
    requestId: request.requestId,
    ok: true,
    ptySessionId: request.ptySessionId,
    processName: 'zsh',
  } satisfies PtyWorkerMessage)
  const result = await spawn
  if (!result.ok) throw new Error(result.message)
  return result.handle
}

export function buildSupervisor(
  worker: FakeWorker,
  options: {
    now?: () => number
    spawnAckTimeoutMs?: number
    writeAckTimeoutMs?: number
    resizeAckTimeoutMs?: number
    maxPendingWriteBytes?: number
  } = {},
) {
  return new WorkerBackedPtySupervisor({
    workerEntry: '/tmp/pty-worker.js',
    spawnWorker: () => worker as never,
    now: options.now,
    spawnAckTimeoutMs: options.spawnAckTimeoutMs,
    writeAckTimeoutMs: options.writeAckTimeoutMs,
    resizeAckTimeoutMs: options.resizeAckTimeoutMs,
    maxPendingWriteBytes: options.maxPendingWriteBytes,
  })
}
