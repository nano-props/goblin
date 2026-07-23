// Tests for the main-side PTY worker IPC bridge. We mock the worker
// subprocess (a fake EventEmitter that records `send` calls) and
// exercise the supervisor's surface: spawn/write/resize/kill,
// listener dispatch, restart-on-crash, and diagnostics.

import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { WorkerBackedPtySupervisor } from '#/server/terminal/pty-supervisor-worker.ts'
import type { PtyWorkerMessage } from '#/server/terminal/pty-worker-protocol.ts'

class FakeWorker extends EventEmitter {
  sent: unknown[] = []
  killed = false
  sendResult = true
  sendError: Error | null = null
  pid = 4242

  send(message: unknown): boolean {
    if (this.sendError) throw this.sendError
    this.sent.push(message)
    return this.sendResult
  }

  kill(): void {
    this.killed = true
  }

  disconnect(): void {}
}

interface SpawnRequest {
  type: 'pty-spawn'
  requestId: string
  ptySessionId: string
  input: { cwd: string; cols: number; rows: number }
}

async function spawnSession(supervisor: WorkerBackedPtySupervisor, worker: FakeWorker) {
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

function buildSupervisor(
  worker: FakeWorker,
  options: {
    now?: () => number
    writeAckTimeoutMs?: number
    maxPendingWriteBytes?: number
  } = {},
) {
  return new WorkerBackedPtySupervisor({
    workerEntry: '/tmp/pty-worker.js',
    spawnWorker: () => worker as never,
    now: options.now,
    writeAckTimeoutMs: options.writeAckTimeoutMs,
    maxPendingWriteBytes: options.maxPendingWriteBytes,
  })
}

describe('WorkerBackedPtySupervisor', () => {
  let worker: FakeWorker

  beforeEach(() => {
    vi.useRealTimers()
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
      workerEntry: '/tmp/pty-worker.js',
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
      failure: { code: 'unknown', recoverable: false },
    } satisfies PtyWorkerMessage)

    await expect(promise).resolves.toEqual({ ok: false, message: 'spawn failed' })
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

  test('fails a recoverable spawn candidate and gives an explicit retry a fresh worker transaction', async () => {
    const workerA = new FakeWorker()
    const workerB = new FakeWorker()
    const workers = [workerA, workerB]
    const supervisor = new WorkerBackedPtySupervisor({
      workerEntry: '/tmp/pty-worker.js',
      spawnWorker: () => workers.shift() as never,
    })
    const first = supervisor.spawn({ cwd: '/repo', cols: 80, rows: 24 })

    const firstRequest = workerA.sent[0] as SpawnRequest
    expect(firstRequest?.type).toBe('pty-spawn')
    if (!firstRequest || firstRequest.type !== 'pty-spawn') return
    workerA.emit('message', {
      type: 'pty-spawn-result',
      requestId: firstRequest.requestId,
      ok: false,
      error: 'posix_spawnp failed',
      failure: { code: 'native-pty-spawn-failed', recoverable: true },
    } satisfies PtyWorkerMessage)

    await expect(first).resolves.toEqual({ ok: false, message: 'posix_spawnp failed' })
    expect(workerA.killed).toBe(true)
    expect(workerB.sent).toEqual([])

    const second = supervisor.spawn({ cwd: '/repo', cols: 80, rows: 24 })
    const secondRequest = workerB.sent[0] as SpawnRequest
    expect(secondRequest?.type).toBe('pty-spawn')
    expect(secondRequest?.requestId).not.toBe(firstRequest.requestId)
    expect(secondRequest?.ptySessionId).not.toBe(firstRequest.ptySessionId)
    expect(secondRequest?.input).toEqual({ cwd: '/repo', cols: 80, rows: 24 })
    workerB.emit('message', {
      type: 'pty-spawn-result',
      requestId: secondRequest.requestId,
      ok: true,
      ptySessionId: secondRequest.ptySessionId,
      processName: 'zsh',
    } satisfies PtyWorkerMessage)

    await expect(second).resolves.toEqual({
      ok: true,
      handle: { ptySessionId: secondRequest.ptySessionId },
      processName: 'zsh',
      events: expect.any(Object),
    })
    expect(supervisor.getDiagnostics().lastFailure).toEqual(
      expect.objectContaining({ kind: 'spawn-failed', detail: 'posix_spawnp failed' }),
    )
  })

  test('retires every candidate lease owned by a failed idle worker before an explicit retry', async () => {
    const workerA = new FakeWorker()
    const workerB = new FakeWorker()
    const workers = [workerA, workerB]
    const supervisor = new WorkerBackedPtySupervisor({
      workerEntry: '/tmp/pty-worker.js',
      spawnWorker: () => workers.shift() as never,
    })
    const first = supervisor.spawn({ cwd: '/repo/one', cols: 80, rows: 24 })
    const second = supervisor.spawn({ cwd: '/repo/two', cols: 100, rows: 30 })
    const firstRequest = workerA.sent[0] as SpawnRequest
    const secondRequest = workerA.sent[1] as SpawnRequest
    if (firstRequest?.type !== 'pty-spawn') throw new Error('expected pty-spawn')
    if (secondRequest?.type !== 'pty-spawn') throw new Error('expected pty-spawn')

    // The second candidate has already produced events. Its completion and
    // buffered event lease must not be reset or adopted by a replacement PTY.
    workerA.emit('message', {
      type: 'pty-data',
      ptySessionId: secondRequest.ptySessionId,
      data: 'old candidate output',
    } satisfies PtyWorkerMessage)
    workerA.emit('message', {
      type: 'pty-exit',
      ptySessionId: secondRequest.ptySessionId,
      code: 1,
      signal: null,
    } satisfies PtyWorkerMessage)

    workerA.emit('message', {
      type: 'pty-spawn-result',
      requestId: firstRequest.requestId,
      ok: false,
      error: 'posix_spawnp failed',
      failure: { code: 'native-pty-spawn-failed', recoverable: true },
    } satisfies PtyWorkerMessage)

    await expect(first).resolves.toEqual({ ok: false, message: 'posix_spawnp failed' })
    await expect(second).resolves.toEqual({ ok: false, message: 'posix_spawnp failed' })
    expect(workerA.killed).toBe(true)
    expect(workerB.sent).toEqual([])

    const retry = supervisor.spawn({ cwd: '/repo/two', cols: 100, rows: 30 })
    const retryRequest = workerB.sent[0] as SpawnRequest
    if (retryRequest?.type !== 'pty-spawn') throw new Error('expected pty-spawn')
    expect(retryRequest.ptySessionId).not.toBe(secondRequest.ptySessionId)
    workerB.emit('message', {
      type: 'pty-spawn-result',
      requestId: retryRequest.requestId,
      ok: true,
      ptySessionId: retryRequest.ptySessionId,
      processName: 'zsh',
    } satisfies PtyWorkerMessage)
    const retried = await retry
    if (!retried.ok) throw new Error(retried.message)

    supervisor.kill(retried.handle)
    expect(workerB.sent).toContainEqual({ type: 'pty-kill', ptySessionId: retryRequest.ptySessionId })

    workerA.emit('exit', 1, null)
    workerA.emit('error', new Error('stale worker exploded'))
    expect(supervisor.getDiagnostics()).toMatchObject({
      state: 'running',
      workerPid: 4242,
      pendingRequests: 0,
    })
  })

  test('does not restart a worker with active sessions after a recoverable pty spawn failure', async () => {
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
      error: 'posix_spawnp failed',
      failure: { code: 'native-pty-spawn-failed', recoverable: true },
    } satisfies PtyWorkerMessage)

    await expect(secondSpawn).resolves.toEqual({ ok: false, message: 'posix_spawnp failed' })
    expect(worker.killed).toBe(false)
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
    let settled = false
    void acceptedResize.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)

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

  test('settles a pending write immediately when its PTY exits before acknowledgement', async () => {
    vi.useFakeTimers()
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
    expect(supervisor.getDiagnostics().pendingRequests).toBe(0)
  })

  test('settles an unacknowledged write as indeterminate after the bounded timeout', async () => {
    vi.useFakeTimers()
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
    expect(supervisor.getDiagnostics().pendingRequests).toBe(1)
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

  test('retains transport byte reservations after caller timeout until a late acknowledgement', async () => {
    vi.useFakeTimers()
    const supervisor = buildSupervisor(worker, { maxPendingWriteBytes: 5, writeAckTimeoutMs: 25 })
    const handle = await spawnSession(supervisor, worker)
    const first = supervisor.write(handle, '12345')

    await vi.advanceTimersByTimeAsync(25)
    await expect(first).resolves.toEqual({ status: 'indeterminate' })

    await expect(supervisor.write(handle, '1')).resolves.toEqual({ status: 'rejected' })
    const firstRequest = worker.sent.at(-1) as { requestId: string }
    worker.emit('message', {
      type: 'pty-write-result',
      requestId: firstRequest.requestId,
      status: 'accepted',
    } satisfies PtyWorkerMessage)

    const afterAck = supervisor.write(handle, '12345')
    expect(worker.sent.at(-1)).toMatchObject({ type: 'pty-write', data: '12345' })
    supervisor.shutdown()
    await expect(afterAck).resolves.toEqual({ status: 'indeterminate' })
  })

  test('killAndWait resolves only after the worker confirms PTY exit', async () => {
    const supervisor = buildSupervisor(worker)
    const spawn = supervisor.spawn({ cwd: '/repo', cols: 80, rows: 24 })
    const request = worker.sent[0] as SpawnRequest
    worker.emit('message', {
      type: 'pty-spawn-result',
      requestId: request.requestId,
      ok: true,
      ptySessionId: request.ptySessionId,
      processName: 'zsh',
    } satisfies PtyWorkerMessage)
    const result = await spawn
    if (!result.ok) throw new Error(result.message)

    let settled = false
    let durableExitSettled = false
    const durableExit = supervisor.waitForExit(result.handle).then(() => {
      durableExitSettled = true
    })
    const closing = supervisor.killAndWait(result.handle).then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(durableExitSettled).toBe(false)
    expect(worker.sent.at(-1)).toEqual({ type: 'pty-kill', ptySessionId: request.ptySessionId })

    worker.emit('message', {
      type: 'pty-exit',
      ptySessionId: request.ptySessionId,
      code: 0,
      signal: null,
    } satisfies PtyWorkerMessage)
    await Promise.all([closing, durableExit])
    expect(settled).toBe(true)
    expect(durableExitSettled).toBe(true)
  })

  test('buffers data received before the spawn result until the event owner activates', async () => {
    const supervisor = buildSupervisor(worker)
    const spawn = supervisor.spawn({ cwd: '/repo', cols: 80, rows: 24 })
    const spawnReq = worker.sent[0] as { type: string; requestId: string; ptySessionId: string }
    if (spawnReq?.type !== 'pty-spawn') throw new Error('expected pty-spawn')
    worker.emit('message', {
      type: 'pty-process-name-changed',
      ptySessionId: spawnReq.ptySessionId,
      processName: 'login',
    } satisfies PtyWorkerMessage)
    worker.emit('message', {
      type: 'pty-data',
      ptySessionId: spawnReq.ptySessionId,
      data: 'startup',
    } satisfies PtyWorkerMessage)
    worker.emit('message', {
      type: 'pty-spawn-result',
      requestId: spawnReq.requestId,
      ok: true,
      ptySessionId: spawnReq.ptySessionId,
      processName: 'zsh',
    } satisfies PtyWorkerMessage)

    const result = await spawn
    if (!result.ok) throw new Error(result.message)
    const data = vi.fn()
    const claim = result.events.claim({ onData: data, onExit: vi.fn() })

    expect(data).not.toHaveBeenCalled()
    claim.activate()
    expect(data).toHaveBeenCalledWith({ data: 'startup', processName: 'login' })

    worker.emit('message', {
      type: 'pty-process-name-changed',
      ptySessionId: spawnReq.ptySessionId,
      processName: 'python',
    } satisfies PtyWorkerMessage)
    worker.emit('message', {
      type: 'pty-data',
      ptySessionId: spawnReq.ptySessionId,
      data: 'hello',
    } satisfies PtyWorkerMessage)
    expect(data).toHaveBeenLastCalledWith({ data: 'hello', processName: 'python' })
  })

  test('pty-exit reaches the spawn event owner and cleans up the session entry', async () => {
    const supervisor = buildSupervisor(worker)
    const spawn = supervisor.spawn({ cwd: '/repo', cols: 80, rows: 24 })
    const spawnReq = worker.sent[0] as { type: string; requestId: string; ptySessionId: string }
    if (spawnReq?.type !== 'pty-spawn') throw new Error('expected pty-spawn')
    worker.emit('message', {
      type: 'pty-spawn-result',
      requestId: spawnReq.requestId,
      ok: true,
      ptySessionId: spawnReq.ptySessionId,
      processName: 'zsh',
    } satisfies PtyWorkerMessage)

    const result = await spawn
    if (!result.ok) throw new Error(result.message)
    const exit = vi.fn()
    const claim = result.events.claim({ onData: vi.fn(), onExit: exit })
    claim.activate()

    worker.emit('message', {
      type: 'pty-exit',
      ptySessionId: spawnReq.ptySessionId,
      code: null,
      signal: null,
    } satisfies PtyWorkerMessage)
    expect(exit).toHaveBeenCalledWith(null, null)
  })

  test('buffers exit received before the spawn result and replays it to the event owner', async () => {
    const supervisor = buildSupervisor(worker)
    const spawn = supervisor.spawn({ cwd: '/repo', cols: 80, rows: 24 })
    const spawnReq = worker.sent[0] as SpawnRequest

    worker.emit('message', {
      type: 'pty-exit',
      ptySessionId: spawnReq.ptySessionId,
      code: 7,
      signal: null,
    } satisfies PtyWorkerMessage)
    worker.emit('message', {
      type: 'pty-spawn-result',
      requestId: spawnReq.requestId,
      ok: true,
      ptySessionId: spawnReq.ptySessionId,
      processName: 'zsh',
    } satisfies PtyWorkerMessage)

    const result = await spawn
    if (!result.ok) throw new Error(result.message)
    const exit = vi.fn()
    const claim = result.events.claim({ onData: vi.fn(), onExit: exit })
    claim.activate()

    expect(exit).toHaveBeenCalledWith(7, null)
  })

  test('preserves an early real process name when the spawn result still contains the placeholder', async () => {
    const supervisor = buildSupervisor(worker)
    const spawn = supervisor.spawn({ cwd: '/repo', cols: 80, rows: 24 })
    const spawnReq = worker.sent[0] as SpawnRequest

    worker.emit('message', {
      type: 'pty-process-name-changed',
      ptySessionId: spawnReq.ptySessionId,
      processName: 'zsh',
    } satisfies PtyWorkerMessage)
    worker.emit('message', {
      type: 'pty-spawn-result',
      requestId: spawnReq.requestId,
      ok: true,
      ptySessionId: spawnReq.ptySessionId,
      processName: 'terminal',
    } satisfies PtyWorkerMessage)

    const result = await spawn
    expect(result).toMatchObject({ ok: true, processName: 'zsh' })
  })

  test('rejects in-flight spawns and fires exit listeners when the worker crashes', async () => {
    const supervisor = buildSupervisor(worker)
    const promise = supervisor.spawn({ cwd: '/repo', cols: 80, rows: 24 })

    worker.emit('exit', 1, null)

    await expect(promise).resolves.toEqual({ ok: false, message: 'PTY worker exited' })
  })

  test('does not prestart an empty worker after a crash terminates every active PTY', async () => {
    const workerA = new FakeWorker()
    const workerB = new FakeWorker()
    const workers = [workerA, workerB]
    const supervisor = new WorkerBackedPtySupervisor({
      workerEntry: '/tmp/pty-worker.js',
      spawnWorker: () => workers.shift() as never,
    })

    // Establish an active session by completing a spawn round-trip.
    const promise = supervisor.spawn({ cwd: '/repo', cols: 80, rows: 24 })
    const request = workerA.sent[0] as SpawnRequest
    if (request?.type !== 'pty-spawn') throw new Error('expected pty-spawn')
    workerA.emit('message', {
      type: 'pty-spawn-result',
      requestId: request.requestId,
      ok: true,
      ptySessionId: request.ptySessionId,
      processName: 'zsh',
    } satisfies PtyWorkerMessage)
    await promise

    expect(supervisor.getDiagnostics().state).toBe('running')
    workerA.emit('exit', 1, null)
    expect(supervisor.getDiagnostics().state).toBe('idle')
    expect(workerB.sent).toEqual([])

    const nextSpawn = supervisor.spawn({ cwd: '/repo/new', cols: 100, rows: 30 })
    expect(workerB.sent).toHaveLength(1)
    const nextRequest = workerB.sent[0] as SpawnRequest
    workerB.emit('message', {
      type: 'pty-spawn-result',
      requestId: nextRequest.requestId,
      ok: true,
      ptySessionId: nextRequest.ptySessionId,
      processName: 'zsh',
    } satisfies PtyWorkerMessage)
    await expect(nextSpawn).resolves.toMatchObject({ ok: true })
  })

  test('reports worker-backed diagnostics after a successful spawn round-trip', async () => {
    const supervisor = buildSupervisor(worker, { now: () => 1_000 })
    expect(supervisor.getDiagnostics()).toMatchObject({
      mode: 'worker-backed',
      state: 'idle',
      workerRunning: false,
      pendingRequests: 0,
      restartScheduled: false,
    })

    const promise = supervisor.spawn({ cwd: '/repo', cols: 80, rows: 24 })
    const request = worker.sent[0] as SpawnRequest
    if (request?.type !== 'pty-spawn') throw new Error('expected pty-spawn')
    worker.emit('message', {
      type: 'pty-spawn-result',
      requestId: request.requestId,
      ok: true,
      ptySessionId: request.ptySessionId,
      processName: 'zsh',
    } satisfies PtyWorkerMessage)
    await promise

    expect(supervisor.getDiagnostics()).toMatchObject({
      mode: 'worker-backed',
      state: 'running',
      workerRunning: true,
      workerPid: 4242,
      pendingRequests: 0,
      lastSuccessfulResponseAt: 1_000,
      lastFailure: null,
    })
  })

  test('shutdown tears the worker down and rejects pending spawns', async () => {
    const supervisor = buildSupervisor(worker)
    const promise = supervisor.spawn({ cwd: '/repo', cols: 80, rows: 24 })
    supervisor.shutdown()

    await expect(promise).resolves.toEqual({ ok: false, message: 'PTY worker stopped' })
    expect(worker.killed).toBe(true)
    expect(supervisor.getDiagnostics().shuttingDown).toBe(true)

    const sentAfterShutdown = worker.sent.length
    await expect(supervisor.spawn({ cwd: '/repo/new', cols: 100, rows: 30 })).resolves.toEqual({
      ok: false,
      message: 'PTY worker stopped',
    })
    expect(worker.sent).toHaveLength(sentAfterShutdown)
  })

  test('shutdown completes an in-flight kill acknowledgement', async () => {
    const supervisor = buildSupervisor(worker)
    const handle = await spawnSession(supervisor, worker)
    const closing = supervisor.killAndWait(handle)

    supervisor.shutdown()

    await expect(closing).resolves.toBeUndefined()
  })

  test('disconnect invalidates the worker and settles every transport-owned operation exactly once', async () => {
    const supervisor = buildSupervisor(worker)
    const firstSpawn = supervisor.spawn({ cwd: '/repo', cols: 80, rows: 24 })
    const firstRequest = worker.sent[0] as SpawnRequest
    worker.emit('message', {
      type: 'pty-spawn-result',
      requestId: firstRequest.requestId,
      ok: true,
      ptySessionId: firstRequest.ptySessionId,
      processName: 'zsh',
    } satisfies PtyWorkerMessage)
    const first = await firstSpawn
    if (!first.ok) throw new Error(first.message)
    const exit = vi.fn()
    const claim = first.events.claim({ onData: vi.fn(), onExit: exit })
    claim.activate()

    const pendingSpawn = supervisor.spawn({ cwd: '/repo/second', cols: 100, rows: 30 })
    const pendingWrite = supervisor.write(first.handle, 'input')
    const pendingResize = supervisor.resize(first.handle, 120, 40)

    worker.emit('disconnect')

    await expect(pendingSpawn).resolves.toEqual({ ok: false, message: 'PTY worker disconnected' })
    await expect(pendingWrite).resolves.toEqual({ status: 'indeterminate' })
    await expect(pendingResize).resolves.toBe(false)
    expect(exit).toHaveBeenCalledOnce()
    expect(exit).toHaveBeenCalledWith(null, null)
    expect(worker.killed).toBe(true)
    expect(supervisor.getDiagnostics()).toMatchObject({
      state: 'idle',
      workerRunning: false,
      pendingRequests: 0,
      restartAttempts: 1,
      lastFailure: { kind: 'disconnect', detail: 'parent IPC channel closed' },
    })

    worker.emit('error', new Error('late error'))
    worker.emit('exit', 1, null)
    expect(exit).toHaveBeenCalledOnce()
    expect(supervisor.getDiagnostics().lastFailure).toEqual(
      expect.objectContaining({ kind: 'disconnect', detail: 'parent IPC channel closed' }),
    )
  })

  test("'error' from the worker is treated like an exit: pending spawns rejected, exit listeners fired, failure recorded", async () => {
    const supervisor = buildSupervisor(worker)
    const promise = supervisor.spawn({ cwd: '/repo', cols: 80, rows: 24 })

    worker.emit('error', new Error('worker exploded'))

    await expect(promise).resolves.toEqual({ ok: false, message: 'worker exploded' })
    expect(supervisor.getDiagnostics().lastFailure).toEqual(
      expect.objectContaining({ kind: 'error', detail: 'worker exploded' }),
    )
  })
})
