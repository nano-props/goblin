import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { WorkerBackedTerminalHost } from '#/server/terminal/terminal-worker-host.ts'
import type { ServerTerminalSocket } from '#/server/terminal/terminal-host.ts'
import type { TerminalWorkerMessage, TerminalWorkerRequest } from '#/server/terminal/terminal-worker-protocol.ts'

class FakeWorker extends EventEmitter {
  sent: TerminalWorkerRequest[] = []
  killed = false
  sendResult = true

  send(message: TerminalWorkerRequest): boolean {
    this.sent.push(message)
    return this.sendResult
  }

  kill(): void {
    this.killed = true
  }

  disconnect(): void {}
}

describe('worker-backed terminal host', () => {
  let worker: FakeWorker

  beforeEach(() => {
    vi.useRealTimers()
    worker = new FakeWorker()
  })

  test('routes terminal requests through the worker and resolves responses', async () => {
    const host = new WorkerBackedTerminalHost({ spawnWorker: () => worker as any })
    const promise = host.write('client_1', { sessionId: 'term_123456789012', data: 'ls', attachmentId: 'attachment_a' })

    const request = worker.sent[0]
    expect(request?.type).toBe('request')
    if (!request || request.type !== 'request') return
    worker.emit('message', {
      type: 'response',
      requestId: request.requestId,
      ok: true,
      payload: true,
    } satisfies TerminalWorkerMessage)

    await expect(promise).resolves.toBe(true)
  })

  test('forwards worker socket output to the registered websocket', () => {
    const host = new WorkerBackedTerminalHost({ spawnWorker: () => worker as any })
    const socket: ServerTerminalSocket = { send: vi.fn(), close: vi.fn() }

    host.registerSocket('client_1', 'attachment_a', socket)

    const register = worker.sent[0]
    expect(register?.type).toBe('socket-register')
    if (!register || register.type !== 'socket-register') return

    worker.emit('message', {
      type: 'socket-send',
      socketId: register.socketId,
      payload: '{"type":"output"}',
    } satisfies TerminalWorkerMessage)

    expect(socket.send).toHaveBeenCalledWith('{"type":"output"}')
  })

  test('rejects pending requests when the worker exits', async () => {
    const host = new WorkerBackedTerminalHost({ spawnWorker: () => worker as any })
    const promise = host.write('client_1', { sessionId: 'term_123456789012', data: 'ls', attachmentId: 'attachment_a' })

    worker.emit('exit')

    await expect(promise).rejects.toThrow('Terminal worker exited')
  })

  test('restarts the worker with backoff when sockets are still registered', async () => {
    vi.useFakeTimers()
    const workerA = new FakeWorker()
    const workerB = new FakeWorker()
    const spawnWorker = vi
      .fn<() => any>()
      .mockImplementationOnce(() => workerA as any)
      .mockImplementationOnce(() => workerB as any)
    const host = new WorkerBackedTerminalHost({
      spawnWorker,
      setTimer: setTimeout,
      clearTimer: clearTimeout,
    })
    const socket: ServerTerminalSocket = { send: vi.fn(), close: vi.fn() }

    host.registerSocket('client_1', 'attachment_a', socket)
    expect(spawnWorker).toHaveBeenCalledTimes(1)

    workerA.emit('exit', 1, null)
    expect(spawnWorker).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(249)
    expect(spawnWorker).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    expect(spawnWorker).toHaveBeenCalledTimes(2)
    expect(workerB.sent).toContainEqual(
      expect.objectContaining({
        type: 'socket-register',
        clientId: 'client_1',
        attachmentId: 'attachment_a',
      }),
    )
  })

  test('backs off longer after repeated rapid exits', async () => {
    vi.useFakeTimers()
    const workerA = new FakeWorker()
    const workerB = new FakeWorker()
    const workerC = new FakeWorker()
    const workers = [workerA, workerB, workerC]
    const spawnWorker = vi.fn<() => any>(() => workers.shift() as any)
    const host = new WorkerBackedTerminalHost({
      spawnWorker,
      setTimer: setTimeout,
      clearTimer: clearTimeout,
    })
    const socket: ServerTerminalSocket = { send: vi.fn(), close: vi.fn() }

    host.registerSocket('client_1', 'attachment_a', socket)
    expect(spawnWorker).toHaveBeenCalledTimes(1)

    workerA.emit('exit', 1, null)
    await vi.advanceTimersByTimeAsync(250)
    expect(spawnWorker).toHaveBeenCalledTimes(2)

    workerB.emit('exit', 1, null)
    await vi.advanceTimersByTimeAsync(499)
    expect(spawnWorker).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(spawnWorker).toHaveBeenCalledTimes(3)
  })

  test('includes last worker failure context when request send fails', async () => {
    const host = new WorkerBackedTerminalHost({ spawnWorker: () => worker as any, now: () => 123 })
    worker.sendResult = false

    await expect(
      host.write('client_1', { sessionId: 'term_123456789012', data: 'ls', attachmentId: 'attachment_a' }),
    ).rejects.toThrow('Terminal worker unavailable (send-failed: action=write)')
  })

  test('reports diagnostics for worker lifecycle state', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const host = new WorkerBackedTerminalHost({
      spawnWorker: () => worker as any,
      now: () => Date.now(),
      setTimer: setTimeout,
      clearTimer: clearTimeout,
    })
    const socket: ServerTerminalSocket = { send: vi.fn(), close: vi.fn() }

    expect(host.getDiagnostics()).toMatchObject({
      state: 'idle',
      workerRunning: false,
      registeredSockets: 0,
      pendingRequests: 0,
      restartScheduled: false,
    })

    host.registerSocket('client_1', 'attachment_a', socket)
    expect(host.getDiagnostics()).toMatchObject({
      state: 'running',
      workerRunning: true,
      registeredSockets: 1,
      workerStartedAt: 1_000,
      workerPid: null,
    })

    worker.emit('exit', 1, null)
    expect(host.getDiagnostics()).toMatchObject({
      state: 'restarting',
      workerRunning: false,
      registeredSockets: 1,
      restartAttempts: 1,
      restartScheduled: true,
      lastExitCode: 1,
      lastExitSignal: null,
      lastWorkerFailure: {
        kind: 'exit',
      },
    })
  })

  test('records last successful response timestamp in diagnostics', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(2_000)
    const host = new WorkerBackedTerminalHost({ spawnWorker: () => worker as any, now: () => Date.now() })
    const promise = host.write('client_1', { sessionId: 'term_123456789012', data: 'ls', attachmentId: 'attachment_a' })

    const request = worker.sent[0]
    expect(request?.type).toBe('request')
    if (!request || request.type !== 'request') return
    worker.emit('message', {
      type: 'response',
      requestId: request.requestId,
      ok: true,
      payload: true,
    } satisfies TerminalWorkerMessage)

    await expect(promise).resolves.toBe(true)
    expect(host.getDiagnostics()).toMatchObject({
      state: 'running',
      lastSuccessfulResponseAt: 2_000,
    })
  })
})
