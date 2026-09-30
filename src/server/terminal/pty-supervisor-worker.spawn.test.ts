// Tests for the main-side PTY worker IPC bridge: spawn admission.

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { useFakeTimers } from '#/test-utils/timers.ts'
import { WorkerBackedPtySupervisor } from '#/server/terminal/pty-supervisor-worker.ts'
import type { PtyWorkerMessage } from '#/server/terminal/pty-worker-protocol.ts'
import { buildSupervisor, FakeWorker, type SpawnRequest } from '#/server/test-utils/pty-supervisor-worker.ts'

describe('WorkerBackedPtySupervisor spawn admission', () => {
  let worker: FakeWorker

  beforeEach(() => {
    worker = new FakeWorker()
  })

  test('spawn sends the main-issued ptySessionId and returns its event lease', async () => {
    const supervisor = buildSupervisor(worker)
    const promise = supervisor.spawn({ cwd: '/repo', cols: 80, rows: 24 })

    const request = worker.sent[0] as SpawnRequest
    expect(request?.type).toBe('pty-spawn')
    if (!request || request.type !== 'pty-spawn') return
    worker.emit('message', {
      type: 'pty-spawn-result',
      requestId: request.requestId,
      ok: true,
      ptySessionId: request.ptySessionId,
      processName: 'zsh',
    } satisfies PtyWorkerMessage)

    await expect(promise).resolves.toEqual({
      ok: true,
      handle: { ptySessionId: request.ptySessionId },
      processName: 'zsh',
      events: expect.any(Object),
    })
  })

  test('settles and releases a spawn when worker creation throws synchronously', async () => {
    const supervisor = new WorkerBackedPtySupervisor({
      workerCommand: ['bun', '/tmp/pty-worker.js'],
      spawnWorker: () => {
        throw new Error('worker unavailable')
      },
    })

    await expect(supervisor.spawn({ cwd: '/repo', cols: 80, rows: 24 })).resolves.toMatchObject({ ok: false })
    expect(supervisor.getDiagnostics()).toMatchObject({ pendingRequests: 0, workerRunning: false })
  })

  test('invalidates a worker that returns a spawn response for a different ptySessionId', async () => {
    const supervisor = buildSupervisor(worker)
    const promise = supervisor.spawn({ cwd: '/repo', cols: 80, rows: 24 })
    const request = worker.sent[0] as SpawnRequest

    worker.emit('message', {
      type: 'pty-spawn-result',
      requestId: request.requestId,
      ok: true,
      ptySessionId: 'pty_mismatched',
      processName: 'zsh',
    } satisfies PtyWorkerMessage)

    await expect(promise).resolves.toEqual({ ok: false, message: 'PTY worker protocol violation' })
    expect(worker.killed).toBe(true)
    expect(supervisor.getDiagnostics()).toMatchObject({
      state: 'idle',
      workerRunning: false,
      pendingRequests: 0,
      lastFailure: {
        kind: 'protocol',
        detail: `action=pty-spawn expected=${request.ptySessionId} received=pty_mismatched`,
      },
    })
  })

  test('invalidates a worker that emits a malformed protocol message', async () => {
    const supervisor = buildSupervisor(worker)
    const promise = supervisor.spawn({ cwd: '/repo', cols: 80, rows: 24 })

    worker.emit('message', { type: 'pty-spawn-result', ok: true })

    await expect(promise).resolves.toEqual({ ok: false, message: 'PTY worker protocol violation' })
    expect(worker.killed).toBe(true)
    expect(supervisor.getDiagnostics()).toMatchObject({
      state: 'idle',
      workerRunning: false,
      pendingRequests: 0,
      lastFailure: { kind: 'protocol', detail: 'malformed worker message' },
    })
  })

  test('spawn failure surfaces a structured error to the caller', async () => {
    const supervisor = buildSupervisor(worker)
    const promise = supervisor.spawn({ cwd: '/repo', cols: 80, rows: 24 })

    const request = worker.sent[0] as SpawnRequest
    expect(request?.type).toBe('pty-spawn')
    if (!request || request.type !== 'pty-spawn') return
    worker.emit('message', {
      type: 'pty-spawn-result',
      requestId: request.requestId,
      ok: false,
      error: 'spawn failed',
    } satisfies PtyWorkerMessage)

    await expect(promise).resolves.toEqual({ ok: false, message: 'spawn failed' })
  })

  test('invalidates a connected worker whose spawn acknowledgement never arrives', async () => {
    useFakeTimers()
    const workerA = new FakeWorker()
    const workerB = new FakeWorker()
    const workers = [workerA, workerB]
    const supervisor = new WorkerBackedPtySupervisor({
      workerCommand: ['bun', '/tmp/pty-worker.js'],
      spawnWorker: () => workers.shift() as never,
      spawnAckTimeoutMs: 10_000,
    })

    const liveSpawn = supervisor.spawn({ cwd: '/repo/live', cols: 80, rows: 24 })
    const liveRequest = workerA.sent[0] as SpawnRequest
    workerA.emit('message', {
      type: 'pty-spawn-result',
      requestId: liveRequest.requestId,
      ok: true,
      ptySessionId: liveRequest.ptySessionId,
      processName: 'zsh',
    } satisfies PtyWorkerMessage)
    const live = await liveSpawn
    if (!live.ok) throw new Error(live.message)
    const liveExit = vi.fn()
    live.events.claim({ onData: vi.fn(), onExit: liveExit }).activate()

    const firstPending = supervisor.spawn({ cwd: '/repo/first', cols: 100, rows: 30 })
    const secondPending = supervisor.spawn({ cwd: '/repo/second', cols: 120, rows: 40 })
    const firstRequest = workerA.sent[1] as SpawnRequest
    let firstSettled = false
    void firstPending.then(() => {
      firstSettled = true
    })

    await vi.advanceTimersByTimeAsync(9_999)
    expect(firstSettled).toBe(false)
    expect(workerA.killed).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    await expect(firstPending).resolves.toEqual({ ok: false, message: 'PTY worker spawn timed out' })
    await expect(secondPending).resolves.toEqual({ ok: false, message: 'PTY worker spawn timed out' })
    expect(workerA.killed).toBe(true)
    expect(liveExit).toHaveBeenCalledWith(null, null)
    expect(supervisor.getDiagnostics()).toMatchObject({
      state: 'idle',
      workerRunning: false,
      pendingRequests: 0,
      lastFailure: {
        kind: 'timeout',
        detail: `action=pty-spawn ptySessionId=${firstRequest.ptySessionId} timeoutMs=10000`,
      },
    })

    workerA.emit('message', {
      type: 'pty-spawn-result',
      requestId: firstRequest.requestId,
      ok: true,
      ptySessionId: firstRequest.ptySessionId,
      processName: 'zsh',
    } satisfies PtyWorkerMessage)

    const retry = supervisor.spawn({ cwd: '/repo/retry', cols: 80, rows: 24 })
    const retryRequest = workerB.sent[0] as SpawnRequest
    workerB.emit('message', {
      type: 'pty-spawn-result',
      requestId: retryRequest.requestId,
      ok: true,
      ptySessionId: retryRequest.ptySessionId,
      processName: 'zsh',
    } satisfies PtyWorkerMessage)
    await expect(retry).resolves.toMatchObject({ ok: true })
    expect(supervisor.getDiagnostics()).toMatchObject({ workerRunning: true, pendingRequests: 0 })
    expect(vi.getTimerCount()).toBe(0)
  })

  test('clears spawn deadlines after successful and failed acknowledgements', async () => {
    useFakeTimers()
    const supervisor = buildSupervisor(worker, { spawnAckTimeoutMs: 25 })

    const successful = supervisor.spawn({ cwd: '/repo/success', cols: 80, rows: 24 })
    const successfulRequest = worker.sent[0] as SpawnRequest
    worker.emit('message', {
      type: 'pty-spawn-result',
      requestId: successfulRequest.requestId,
      ok: true,
      ptySessionId: successfulRequest.ptySessionId,
      processName: 'zsh',
    } satisfies PtyWorkerMessage)
    await expect(successful).resolves.toMatchObject({ ok: true })

    const failed = supervisor.spawn({ cwd: '/repo/failure', cols: 80, rows: 24 })
    const failedRequest = worker.sent[1] as SpawnRequest
    worker.emit('message', {
      type: 'pty-spawn-result',
      requestId: failedRequest.requestId,
      ok: false,
      error: 'spawn failed',
    } satisfies PtyWorkerMessage)
    await expect(failed).resolves.toEqual({ ok: false, message: 'spawn failed' })

    await vi.advanceTimersByTimeAsync(25)
    expect(worker.killed).toBe(false)
    expect(supervisor.getDiagnostics()).toMatchObject({
      workerRunning: true,
      pendingRequests: 0,
      lastFailure: { kind: 'spawn-failed', detail: 'spawn failed' },
    })
    expect(vi.getTimerCount()).toBe(0)
  })

  test('waits for the spawn result when IPC send reports backpressure', async () => {
    worker.sendResult = false
    const supervisor = buildSupervisor(worker)
    const promise = supervisor.spawn({ cwd: '/repo', cols: 80, rows: 24 })
    const request = worker.sent[0] as SpawnRequest

    worker.emit('message', {
      type: 'pty-spawn-result',
      requestId: request.requestId,
      ok: true,
      ptySessionId: request.ptySessionId,
      processName: 'zsh',
    } satisfies PtyWorkerMessage)

    await expect(promise).resolves.toMatchObject({
      ok: true,
      handle: { ptySessionId: request.ptySessionId },
    })
  })

  test('atomically retires a spawn candidate when IPC send throws', async () => {
    worker.sendError = new Error('IPC channel closed')
    const supervisor = buildSupervisor(worker)

    await expect(supervisor.spawn({ cwd: '/repo', cols: 80, rows: 24 })).resolves.toEqual({
      ok: false,
      message: 'PTY worker unavailable (send-failed: action=pty-spawn)',
    })
    expect(supervisor.getDiagnostics()).toMatchObject({
      pendingRequests: 0,
      lastFailure: { kind: 'send-failed' },
    })

    worker.sendError = null
    const retry = supervisor.spawn({ cwd: '/repo', cols: 80, rows: 24 })
    const request = worker.sent.at(-1) as SpawnRequest
    worker.emit('message', {
      type: 'pty-spawn-result',
      requestId: request.requestId,
      ok: true,
      ptySessionId: request.ptySessionId,
      processName: 'zsh',
    } satisfies PtyWorkerMessage)
    await expect(retry).resolves.toMatchObject({ ok: true })
  })

  test('retires the worker when IPC asynchronously rejects a spawn send', async () => {
    const workerA = new FakeWorker()
    const workerB = new FakeWorker()
    const workers = [workerA, workerB]
    const supervisor = new WorkerBackedPtySupervisor({
      workerCommand: ['bun', '/tmp/pty-worker.js'],
      spawnWorker: () => workers.shift() as never,
    })
    const first = supervisor.spawn({ cwd: '/repo', cols: 80, rows: 24 })
    const firstRequest = workerA.sent[0] as SpawnRequest
    workerA.emit('message', {
      type: 'pty-spawn-result',
      requestId: firstRequest.requestId,
      ok: true,
      ptySessionId: firstRequest.ptySessionId,
      processName: 'zsh',
    } satisfies PtyWorkerMessage)
    const firstResult = await first
    if (!firstResult.ok) throw new Error(firstResult.message)
    const onExit = vi.fn()
    firstResult.events.claim({ onData: vi.fn(), onExit }).activate()
    workerA.sendCallbackError = new Error('IPC channel closed')

    await expect(supervisor.spawn({ cwd: '/repo/second', cols: 100, rows: 30 })).resolves.toEqual({
      ok: false,
      message: 'PTY worker unavailable (send-failed: action=pty-spawn)',
    })
    expect(workerA.killed).toBe(true)
    expect(onExit).toHaveBeenCalledWith(null, null)
    expect(supervisor.getDiagnostics()).toMatchObject({
      state: 'idle',
      workerRunning: false,
      pendingRequests: 0,
      lastFailure: { kind: 'send-failed', detail: 'action=pty-spawn' },
    })

    const retry = supervisor.spawn({ cwd: '/repo', cols: 80, rows: 24 })
    const request = workerB.sent[0] as SpawnRequest
    workerB.emit('message', {
      type: 'pty-spawn-result',
      requestId: request.requestId,
      ok: true,
      ptySessionId: request.ptySessionId,
      processName: 'zsh',
    } satisfies PtyWorkerMessage)
    await expect(retry).resolves.toMatchObject({ ok: true })
  })

  test('a failed spawn preserves other candidates and allows an explicit retry', async () => {
    const supervisor = buildSupervisor(worker)
    const first = supervisor.spawn({ cwd: '/repo/one', cols: 80, rows: 24 })
    const second = supervisor.spawn({ cwd: '/repo/two', cols: 80, rows: 24 })
    const firstRequest = worker.sent[0] as SpawnRequest
    const secondRequest = worker.sent[1] as SpawnRequest
    worker.emit('message', {
      type: 'pty-spawn-result',
      requestId: firstRequest.requestId,
      ok: false,
      error: 'shell not found',
    } satisfies PtyWorkerMessage)
    await expect(first).resolves.toEqual({ ok: false, message: 'shell not found' })
    expect(worker.killed).toBe(false)
    worker.emit('message', {
      type: 'pty-spawn-result',
      requestId: secondRequest.requestId,
      ok: true,
      ptySessionId: secondRequest.ptySessionId,
      processName: 'sh',
    } satisfies PtyWorkerMessage)
    await expect(second).resolves.toMatchObject({ ok: true })
    const retry = supervisor.spawn({ cwd: '/repo/one', cols: 80, rows: 24 })
    const retryRequest = worker.sent[2] as SpawnRequest
    expect(retryRequest.ptySessionId).not.toBe(firstRequest.ptySessionId)
    worker.emit('message', {
      type: 'pty-spawn-result',
      requestId: retryRequest.requestId,
      ok: true,
      ptySessionId: retryRequest.ptySessionId,
      processName: 'sh',
    } satisfies PtyWorkerMessage)
    await expect(retry).resolves.toMatchObject({ ok: true })
    expect(supervisor.getDiagnostics().lastFailure).toMatchObject({
      kind: 'spawn-failed',
      detail: 'shell not found',
    })
  })

  test('does not restart a worker with active sessions after a PTY spawn failure', async () => {
    const supervisor = buildSupervisor(worker)
    const firstSpawn = supervisor.spawn({ cwd: '/repo', cols: 80, rows: 24 })
    const firstRequest = worker.sent[0] as SpawnRequest
    if (firstRequest?.type !== 'pty-spawn') throw new Error('expected pty-spawn')
    worker.emit('message', {
      type: 'pty-spawn-result',
      requestId: firstRequest.requestId,
      ok: true,
      ptySessionId: firstRequest.ptySessionId,
      processName: 'zsh',
    } satisfies PtyWorkerMessage)
    await firstSpawn

    const secondSpawn = supervisor.spawn({ cwd: '/repo', cols: 80, rows: 24 })
    const secondRequest = worker.sent[1] as SpawnRequest
    if (secondRequest?.type !== 'pty-spawn') throw new Error('expected pty-spawn')
    worker.emit('message', {
      type: 'pty-spawn-result',
      requestId: secondRequest.requestId,
      ok: false,
      error: 'shell not found',
    } satisfies PtyWorkerMessage)

    await expect(secondSpawn).resolves.toEqual({ ok: false, message: 'shell not found' })
    expect(worker.killed).toBe(false)
  })
})
