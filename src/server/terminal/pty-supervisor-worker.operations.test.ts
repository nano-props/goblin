// Tests for the main-side PTY worker IPC bridge: PTY operations.

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { useFakeTimers } from '#/test-utils/timers.ts'
import { WorkerBackedPtySupervisor } from '#/server/terminal/pty-supervisor-worker.ts'
import type { PtyWorkerMessage } from '#/server/terminal/pty-worker-protocol.ts'
import {
  buildSupervisor,
  FakeWorker,
  type SpawnRequest,
  spawnSession,
} from '#/server/test-utils/pty-supervisor-worker.ts'

describe('WorkerBackedPtySupervisor PTY operations', () => {
  let worker: FakeWorker

  beforeEach(() => {
    worker = new FakeWorker()
  })

  test('write resolves only after the worker acknowledges the PTY call', async () => {
    const supervisor = buildSupervisor(worker)
    const spawn = supervisor.spawn({ cwd: '/repo', cols: 80, rows: 24 })
    const spawnRequest = worker.sent[0] as SpawnRequest
    worker.emit('message', {
      type: 'pty-spawn-result',
      requestId: spawnRequest.requestId,
      ok: true,
      ptySessionId: spawnRequest.ptySessionId,
      processName: 'zsh',
    } satisfies PtyWorkerMessage)
    const spawned = await spawn
    if (!spawned.ok) throw new Error(spawned.message)
    const handle = spawned.handle

    const write = supervisor.write(handle, 'ls\n')
    const writeRequest = worker.sent.at(-1) as { type: string; requestId: string }
    const resize = supervisor.resize(handle, 100, 30)
    const resizeRequest = worker.sent.at(-1) as { type: string; requestId: string }
    supervisor.kill(handle)

    expect(worker.sent.slice(1)).toEqual([
      { type: 'pty-write', requestId: writeRequest.requestId, ptySessionId: spawnRequest.ptySessionId, data: 'ls\n' },
      {
        type: 'pty-resize',
        requestId: resizeRequest.requestId,
        ptySessionId: spawnRequest.ptySessionId,
        cols: 100,
        rows: 30,
      },
      { type: 'pty-kill', ptySessionId: spawnRequest.ptySessionId },
    ])
    worker.emit('message', {
      type: 'pty-write-result',
      requestId: writeRequest.requestId,
      status: 'accepted',
    } satisfies PtyWorkerMessage)
    worker.emit('message', {
      type: 'pty-resize-result',
      requestId: resizeRequest.requestId,
      accepted: true,
    } satisfies PtyWorkerMessage)
    await expect(write).resolves.toEqual({ status: 'accepted' })
    await expect(resize).resolves.toBe(true)
  })

  test('settles a pending write as indeterminate when the worker exits', async () => {
    const supervisor = buildSupervisor(worker)
    const handle = await spawnSession(supervisor, worker)
    const write = supervisor.write(handle, 'input')

    worker.emit('exit', 1, null)

    await expect(write).resolves.toEqual({ status: 'indeterminate' })
    expect(supervisor.getDiagnostics().pendingRequests).toBe(0)
  })

  test('commits resize only after the worker acknowledgement and rejects it on exit', async () => {
    const supervisor = buildSupervisor(worker)
    const handle = await spawnSession(supervisor, worker)
    const acceptedResize = supervisor.resize(handle, 100, 30)
    const acceptedRequest = worker.sent.at(-1) as { requestId: string }
    expect(supervisor.getDiagnostics().pendingRequests).toBe(1)

    worker.emit('message', {
      type: 'pty-resize-result',
      requestId: acceptedRequest.requestId,
      accepted: true,
    } satisfies PtyWorkerMessage)
    await expect(acceptedResize).resolves.toBe(true)

    const interruptedResize = supervisor.resize(handle, 120, 40)
    worker.emit('exit', 1, null)
    await expect(interruptedResize).resolves.toBe(false)
    expect(supervisor.getDiagnostics().pendingRequests).toBe(0)
  })

  test('retires the worker when IPC asynchronously rejects a resize send', async () => {
    const workerA = new FakeWorker()
    const workerB = new FakeWorker()
    const workers = [workerA, workerB]
    const supervisor = new WorkerBackedPtySupervisor({
      workerEntry: '/tmp/pty-worker.js',
      spawnWorker: () => workers.shift() as never,
    })
    const handle = await spawnSession(supervisor, workerA)
    workerA.sendCallbackError = new Error('IPC channel closed')

    await expect(supervisor.resize(handle, 100, 30)).resolves.toBe(false)

    expect(workerA.killed).toBe(true)
    expect(supervisor.getDiagnostics()).toMatchObject({
      state: 'idle',
      workerRunning: false,
      pendingRequests: 0,
      lastFailure: {
        kind: 'send-failed',
        detail: `action=pty-resize ptySessionId=${handle.ptySessionId}`,
      },
    })

    const retry = supervisor.spawn({ cwd: '/repo', cols: 80, rows: 24 })
    expect(workerB.sent[0]).toMatchObject({ type: 'pty-spawn' })
    supervisor.shutdown()
    await expect(retry).resolves.toEqual({ ok: false, message: 'PTY worker stopped' })
  })

  test('retires an indeterminate worker when a resize acknowledgement times out', async () => {
    useFakeTimers()
    const supervisor = buildSupervisor(worker, { resizeAckTimeoutMs: 25 })
    const spawning = supervisor.spawn({ cwd: '/repo', cols: 80, rows: 24 })
    const spawnRequest = worker.sent.at(-1) as SpawnRequest
    worker.emit('message', {
      type: 'pty-spawn-result',
      requestId: spawnRequest.requestId,
      ok: true,
      ptySessionId: spawnRequest.ptySessionId,
      processName: 'zsh',
    } satisfies PtyWorkerMessage)
    const spawned = await spawning
    if (!spawned.ok) throw new Error(spawned.message)
    const handle = spawned.handle
    const onExit = vi.fn()
    spawned.events.claim({ onData: vi.fn(), onExit }).activate()

    const resize = supervisor.resize(handle, 100, 30)
    await vi.advanceTimersByTimeAsync(25)

    await expect(resize).resolves.toBe(false)
    expect(worker.killed).toBe(true)
    expect(onExit).toHaveBeenCalledWith(null, null)
    expect(supervisor.getDiagnostics()).toMatchObject({
      state: 'idle',
      workerRunning: false,
      pendingRequests: 0,
      lastFailure: {
        kind: 'timeout',
        detail: `action=pty-resize ptySessionId=${handle.ptySessionId} timeoutMs=25`,
      },
    })
    expect(vi.getTimerCount()).toBe(0)
  })

  test('settles a pending write immediately when its PTY exits before acknowledgement', async () => {
    useFakeTimers()
    const supervisor = buildSupervisor(worker)
    const handle = await spawnSession(supervisor, worker)
    const write = supervisor.write(handle, 'input')

    worker.emit('message', {
      type: 'pty-exit',
      ptySessionId: handle.ptySessionId,
      code: 0,
      signal: null,
    } satisfies PtyWorkerMessage)

    await expect(write).resolves.toEqual({ status: 'indeterminate' })
    expect(supervisor.getDiagnostics().pendingRequests).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  test('rejects a write when IPC send throws before acceptance', async () => {
    const supervisor = buildSupervisor(worker)
    const handle = await spawnSession(supervisor, worker)
    worker.sendError = new Error('channel closed')

    await expect(supervisor.write(handle, 'input')).resolves.toEqual({ status: 'rejected' })
    expect(worker.killed).toBe(true)
    expect(supervisor.getDiagnostics()).toMatchObject({
      state: 'idle',
      workerRunning: false,
      pendingRequests: 0,
      lastFailure: {
        kind: 'send-failed',
        detail: `action=pty-write ptySessionId=${handle.ptySessionId}`,
      },
    })
  })

  test('retires the worker when IPC asynchronously rejects a write send', async () => {
    const workerA = new FakeWorker()
    const workerB = new FakeWorker()
    const workers = [workerA, workerB]
    const supervisor = new WorkerBackedPtySupervisor({
      workerEntry: '/tmp/pty-worker.js',
      spawnWorker: () => workers.shift() as never,
    })
    const handle = await spawnSession(supervisor, workerA)
    workerA.sendCallbackError = new Error('IPC channel closed')

    await expect(supervisor.write(handle, 'input')).resolves.toEqual({ status: 'rejected' })

    expect(workerA.killed).toBe(true)
    expect(supervisor.getDiagnostics()).toMatchObject({
      state: 'idle',
      workerRunning: false,
      pendingRequests: 0,
      lastFailure: {
        kind: 'send-failed',
        detail: `action=pty-write ptySessionId=${handle.ptySessionId}`,
      },
    })

    const retry = supervisor.spawn({ cwd: '/repo', cols: 80, rows: 24 })
    expect(workerB.sent[0]).toMatchObject({ type: 'pty-spawn' })
    supervisor.shutdown()
    await expect(retry).resolves.toEqual({ ok: false, message: 'PTY worker stopped' })
  })

  test('retires an indeterminate worker when a write acknowledgement times out', async () => {
    useFakeTimers()
    const supervisor = new WorkerBackedPtySupervisor({
      workerEntry: '/tmp/pty-worker.js',
      spawnWorker: () => worker as never,
      writeAckTimeoutMs: 25,
    })
    const handle = await spawnSession(supervisor, worker)
    const write = supervisor.write(handle, 'input')
    const request = worker.sent.at(-1) as { requestId: string }

    await vi.advanceTimersByTimeAsync(25)

    await expect(write).resolves.toEqual({ status: 'indeterminate' })
    expect(worker.killed).toBe(true)
    expect(supervisor.getDiagnostics()).toMatchObject({
      state: 'idle',
      workerRunning: false,
      pendingRequests: 0,
      lastFailure: {
        kind: 'timeout',
        detail: `action=pty-write ptySessionId=${handle.ptySessionId} timeoutMs=25`,
      },
    })
    worker.emit('message', {
      type: 'pty-write-result',
      requestId: request.requestId,
      status: 'accepted',
    } satisfies PtyWorkerMessage)
    expect(supervisor.getDiagnostics().pendingRequests).toBe(0)
  })

  test('bounds pending write bytes and releases the budget after acknowledgement', async () => {
    const supervisor = buildSupervisor(worker, { maxPendingWriteBytes: 5 })
    const handle = await spawnSession(supervisor, worker)
    const first = supervisor.write(handle, '你')
    const firstRequest = worker.sent.at(-1) as { requestId: string }

    await expect(supervisor.write(handle, '好好')).resolves.toEqual({ status: 'rejected' })
    expect(worker.sent).toHaveLength(2)

    worker.emit('message', {
      type: 'pty-write-result',
      requestId: firstRequest.requestId,
      status: 'accepted',
    } satisfies PtyWorkerMessage)
    await expect(first).resolves.toEqual({ status: 'accepted' })

    const afterAck = supervisor.write(handle, '好')
    const afterAckRequest = worker.sent.at(-1) as { requestId: string }
    worker.emit('message', {
      type: 'pty-write-result',
      requestId: afterAckRequest.requestId,
      status: 'accepted',
    } satisfies PtyWorkerMessage)
    await expect(afterAck).resolves.toEqual({ status: 'accepted' })
  })
})
