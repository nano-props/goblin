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

async function spawnSession(supervisor: WorkerBackedPtySupervisor, worker: FakeWorker, ptySessionId = 'pty_abc') {
  const spawn = supervisor.spawn({ cwd: '/repo', cols: 80, rows: 24 })
  const request = worker.sent.at(-1) as { type: string; requestId: string }
  worker.emit('message', {
    type: 'pty-spawn-result',
    requestId: request.requestId,
    ok: true,
    ptySessionId,
    processName: 'zsh',
  } satisfies PtyWorkerMessage)
  const result = await spawn
  if (!result.ok) throw new Error(result.message)
  return result.handle
}

function buildSupervisor(
  worker: FakeWorker,
  options: { now?: () => number; setTimer?: typeof setTimeout; clearTimer?: typeof clearTimeout } = {},
) {
  return new WorkerBackedPtySupervisor({
    workerEntry: '/tmp/pty-worker.js',
    spawnWorker: () => worker as never,
    now: options.now,
    setTimer: options.setTimer as never,
    clearTimer: options.clearTimer as never,
  })
}

describe('WorkerBackedPtySupervisor', () => {
  let worker: FakeWorker

  beforeEach(() => {
    vi.useRealTimers()
    worker = new FakeWorker()
  })

  test('spawn sends pty-spawn and resolves with the worker-issued ptySessionId', async () => {
    const supervisor = buildSupervisor(worker)
    const promise = supervisor.spawn({ cwd: '/repo', cols: 80, rows: 24 })

    const request = worker.sent[0] as { type: string; requestId: string; input: unknown }
    expect(request?.type).toBe('pty-spawn')
    if (!request || request.type !== 'pty-spawn') return
    worker.emit('message', {
      type: 'pty-spawn-result',
      requestId: request.requestId,
      ok: true,
      ptySessionId: 'pty_abc',
      processName: 'zsh',
    } satisfies PtyWorkerMessage)

    await expect(promise).resolves.toEqual({
      ok: true,
      handle: { ptySessionId: 'pty_abc' },
      processName: 'zsh',
    })
  })

  test('spawn failure surfaces a structured error to the caller', async () => {
    const supervisor = buildSupervisor(worker)
    const promise = supervisor.spawn({ cwd: '/repo', cols: 80, rows: 24 })

    const request = worker.sent[0] as { type: string; requestId: string }
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

  test('restarts an idle worker and retries once after a recoverable pty spawn failure', async () => {
    const workerA = new FakeWorker()
    const workerB = new FakeWorker()
    const workers = [workerA, workerB]
    const supervisor = new WorkerBackedPtySupervisor({
      workerEntry: '/tmp/pty-worker.js',
      spawnWorker: () => workers.shift() as never,
    })
    const promise = supervisor.spawn({ cwd: '/repo', cols: 80, rows: 24 })

    const firstRequest = workerA.sent[0] as { type: string; requestId: string }
    expect(firstRequest?.type).toBe('pty-spawn')
    if (!firstRequest || firstRequest.type !== 'pty-spawn') return
    workerA.emit('message', {
      type: 'pty-spawn-result',
      requestId: firstRequest.requestId,
      ok: false,
      error: 'posix_spawnp failed',
      failure: { code: 'native-pty-spawn-failed', recoverable: true },
    } satisfies PtyWorkerMessage)

    expect(workerA.killed).toBe(true)
    const secondRequest = workerB.sent[0] as { type: string; requestId: string; input: unknown }
    expect(secondRequest?.type).toBe('pty-spawn')
    expect(secondRequest?.requestId).not.toBe(firstRequest.requestId)
    expect(secondRequest?.input).toEqual({ cwd: '/repo', cols: 80, rows: 24 })
    workerB.emit('message', {
      type: 'pty-spawn-result',
      requestId: secondRequest.requestId,
      ok: true,
      ptySessionId: 'pty_recovered',
      processName: 'zsh',
    } satisfies PtyWorkerMessage)

    await expect(promise).resolves.toEqual({
      ok: true,
      handle: { ptySessionId: 'pty_recovered' },
      processName: 'zsh',
    })
    expect(supervisor.getDiagnostics().lastFailure).toEqual(
      expect.objectContaining({ kind: 'spawn-failed', detail: 'posix_spawnp failed' }),
    )
  })

  test('moves every pending spawn to the replacement worker after a recoverable pty spawn failure', async () => {
    const workerA = new FakeWorker()
    const workerB = new FakeWorker()
    const workers = [workerA, workerB]
    const supervisor = new WorkerBackedPtySupervisor({
      workerEntry: '/tmp/pty-worker.js',
      spawnWorker: () => workers.shift() as never,
    })
    const first = supervisor.spawn({ cwd: '/repo/one', cols: 80, rows: 24 })
    const second = supervisor.spawn({ cwd: '/repo/two', cols: 100, rows: 30 })
    const firstRequest = workerA.sent[0] as { type: string; requestId: string }
    if (firstRequest?.type !== 'pty-spawn') throw new Error('expected pty-spawn')

    workerA.emit('message', {
      type: 'pty-spawn-result',
      requestId: firstRequest.requestId,
      ok: false,
      error: 'posix_spawnp failed',
      failure: { code: 'native-pty-spawn-failed', recoverable: true },
    } satisfies PtyWorkerMessage)

    const replacementRequests = workerB.sent as Array<{ type: string; requestId: string; input: { cwd: string } }>
    expect(replacementRequests.map((request) => request.input.cwd).sort()).toEqual(['/repo/one', '/repo/two'])
    for (const request of replacementRequests) {
      workerB.emit('message', {
        type: 'pty-spawn-result',
        requestId: request.requestId,
        ok: true,
        ptySessionId: request.input.cwd.endsWith('/one') ? 'pty_one' : 'pty_two',
        processName: 'zsh',
      } satisfies PtyWorkerMessage)
    }

    await expect(first).resolves.toEqual({ ok: true, handle: { ptySessionId: 'pty_one' }, processName: 'zsh' })
    await expect(second).resolves.toEqual({ ok: true, handle: { ptySessionId: 'pty_two' }, processName: 'zsh' })
  })

  test('ignores messages from a worker that was replaced during spawn recovery', async () => {
    const workerA = new FakeWorker()
    const workerB = new FakeWorker()
    const workers = [workerA, workerB]
    const supervisor = new WorkerBackedPtySupervisor({
      workerEntry: '/tmp/pty-worker.js',
      spawnWorker: () => workers.shift() as never,
    })
    const promise = supervisor.spawn({ cwd: '/repo', cols: 80, rows: 24 })
    const firstRequest = workerA.sent[0] as { type: string; requestId: string }
    if (firstRequest?.type !== 'pty-spawn') throw new Error('expected pty-spawn')
    workerA.emit('message', {
      type: 'pty-spawn-result',
      requestId: firstRequest.requestId,
      ok: false,
      error: 'posix_spawnp failed',
      failure: { code: 'native-pty-spawn-failed', recoverable: true },
    } satisfies PtyWorkerMessage)

    const secondRequest = workerB.sent[0] as { type: string; requestId: string }
    if (secondRequest?.type !== 'pty-spawn') throw new Error('expected pty-spawn')
    workerB.emit('message', {
      type: 'pty-spawn-result',
      requestId: secondRequest.requestId,
      ok: true,
      ptySessionId: 'pty_recovered',
      processName: 'zsh',
    } satisfies PtyWorkerMessage)
    const result = await promise
    if (!result.ok) throw new Error('expected recovered spawn')

    const data = vi.fn()
    supervisor.onData(result.handle, data)
    workerA.emit('message', {
      type: 'pty-data',
      ptySessionId: 'pty_recovered',
      data: 'stale',
    } satisfies PtyWorkerMessage)
    workerB.emit('message', {
      type: 'pty-data',
      ptySessionId: 'pty_recovered',
      data: 'current',
    } satisfies PtyWorkerMessage)

    expect(data).toHaveBeenCalledTimes(1)
    expect(data).toHaveBeenCalledWith('current')
  })

  test('ignores exit and error from a worker that was replaced during spawn recovery', async () => {
    const workerA = new FakeWorker()
    const workerB = new FakeWorker()
    const workers = [workerA, workerB]
    const supervisor = new WorkerBackedPtySupervisor({
      workerEntry: '/tmp/pty-worker.js',
      spawnWorker: () => workers.shift() as never,
    })
    const promise = supervisor.spawn({ cwd: '/repo', cols: 80, rows: 24 })
    const firstRequest = workerA.sent[0] as { type: string; requestId: string }
    if (firstRequest?.type !== 'pty-spawn') throw new Error('expected pty-spawn')
    workerA.emit('message', {
      type: 'pty-spawn-result',
      requestId: firstRequest.requestId,
      ok: false,
      error: 'posix_spawnp failed',
      failure: { code: 'native-pty-spawn-failed', recoverable: true },
    } satisfies PtyWorkerMessage)

    workerA.emit('exit', 1, null)
    workerA.emit('error', new Error('stale worker exploded'))
    expect(supervisor.getDiagnostics()).toMatchObject({
      state: 'running',
      workerPid: 4242,
      pendingRequests: 1,
    })

    const secondRequest = workerB.sent[0] as { type: string; requestId: string }
    if (secondRequest?.type !== 'pty-spawn') throw new Error('expected pty-spawn')
    workerB.emit('message', {
      type: 'pty-spawn-result',
      requestId: secondRequest.requestId,
      ok: true,
      ptySessionId: 'pty_recovered',
      processName: 'zsh',
    } satisfies PtyWorkerMessage)

    await expect(promise).resolves.toEqual({
      ok: true,
      handle: { ptySessionId: 'pty_recovered' },
      processName: 'zsh',
    })
  })

  test('does not retry more than once after repeated recoverable pty spawn failures', async () => {
    const workerA = new FakeWorker()
    const workerB = new FakeWorker()
    const workerC = new FakeWorker()
    const workers = [workerA, workerB, workerC]
    const supervisor = new WorkerBackedPtySupervisor({
      workerEntry: '/tmp/pty-worker.js',
      spawnWorker: () => workers.shift() as never,
    })
    const promise = supervisor.spawn({ cwd: '/repo', cols: 80, rows: 24 })
    const firstRequest = workerA.sent[0] as { type: string; requestId: string }
    if (firstRequest?.type !== 'pty-spawn') throw new Error('expected pty-spawn')
    workerA.emit('message', {
      type: 'pty-spawn-result',
      requestId: firstRequest.requestId,
      ok: false,
      error: 'posix_spawnp failed',
      failure: { code: 'native-pty-spawn-failed', recoverable: true },
    } satisfies PtyWorkerMessage)

    const secondRequest = workerB.sent[0] as { type: string; requestId: string }
    if (secondRequest?.type !== 'pty-spawn') throw new Error('expected pty-spawn')
    workerB.emit('message', {
      type: 'pty-spawn-result',
      requestId: secondRequest.requestId,
      ok: false,
      error: 'posix_spawnp failed',
      failure: { code: 'native-pty-spawn-failed', recoverable: true },
    } satisfies PtyWorkerMessage)

    await expect(promise).resolves.toEqual({ ok: false, message: 'posix_spawnp failed' })
    expect(workerC.sent).toEqual([])
  })

  test('does not restart a worker with active sessions after a recoverable pty spawn failure', async () => {
    const supervisor = buildSupervisor(worker)
    const firstSpawn = supervisor.spawn({ cwd: '/repo', cols: 80, rows: 24 })
    const firstRequest = worker.sent[0] as { type: string; requestId: string }
    if (firstRequest?.type !== 'pty-spawn') throw new Error('expected pty-spawn')
    worker.emit('message', {
      type: 'pty-spawn-result',
      requestId: firstRequest.requestId,
      ok: true,
      ptySessionId: 'pty_existing',
      processName: 'zsh',
    } satisfies PtyWorkerMessage)
    await firstSpawn

    const secondSpawn = supervisor.spawn({ cwd: '/repo', cols: 80, rows: 24 })
    const secondRequest = worker.sent[1] as { type: string; requestId: string }
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
    const spawnRequest = worker.sent[0] as { type: string; requestId: string }
    worker.emit('message', {
      type: 'pty-spawn-result',
      requestId: spawnRequest.requestId,
      ok: true,
      ptySessionId: 'pty_abc',
      processName: 'zsh',
    } satisfies PtyWorkerMessage)
    const spawned = await spawn
    if (!spawned.ok) throw new Error(spawned.message)
    const handle = spawned.handle

    const write = supervisor.write(handle, 'ls\n')
    const writeRequest = worker.sent.at(-1) as { type: string; requestId: string }
    supervisor.resize(handle, 100, 30)
    supervisor.kill(handle)

    expect(worker.sent.slice(1)).toEqual([
      { type: 'pty-write', requestId: writeRequest.requestId, ptySessionId: 'pty_abc', data: 'ls\n' },
      { type: 'pty-resize', ptySessionId: 'pty_abc', cols: 100, rows: 30 },
      { type: 'pty-kill', ptySessionId: 'pty_abc' },
    ])
    worker.emit('message', {
      type: 'pty-write-result',
      requestId: writeRequest.requestId,
      status: 'accepted',
    } satisfies PtyWorkerMessage)
    await expect(write).resolves.toEqual({ status: 'accepted' })
  })

  test('settles a pending write as indeterminate when the worker exits', async () => {
    const supervisor = buildSupervisor(worker)
    const handle = await spawnSession(supervisor, worker)
    const write = supervisor.write(handle, 'input')

    worker.emit('exit', 1, null)

    await expect(write).resolves.toEqual({ status: 'indeterminate' })
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

    await vi.advanceTimersByTimeAsync(25)

    await expect(write).resolves.toEqual({ status: 'indeterminate' })
    expect(supervisor.getDiagnostics().pendingRequests).toBe(0)
  })

  test('killAndWait resolves only after the worker confirms PTY exit', async () => {
    const supervisor = buildSupervisor(worker)
    const spawn = supervisor.spawn({ cwd: '/repo', cols: 80, rows: 24 })
    const request = worker.sent[0] as { type: string; requestId: string }
    worker.emit('message', {
      type: 'pty-spawn-result',
      requestId: request.requestId,
      ok: true,
      ptySessionId: 'pty_abc',
      processName: 'zsh',
    } satisfies PtyWorkerMessage)
    const result = await spawn
    if (!result.ok) throw new Error(result.message)

    let settled = false
    const closing = supervisor.killAndWait(result.handle).then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(worker.sent.at(-1)).toEqual({ type: 'pty-kill', ptySessionId: 'pty_abc' })

    worker.emit('message', {
      type: 'pty-exit',
      ptySessionId: 'pty_abc',
      code: 0,
      signal: null,
    } satisfies PtyWorkerMessage)
    await closing
    expect(settled).toBe(true)
  })

  test('pty-data from the worker fans out to all subscribed data listeners', () => {
    const supervisor = buildSupervisor(worker)
    void supervisor.spawn({ cwd: '/repo', cols: 80, rows: 24 })
    const spawnReq = worker.sent[0] as { type: string; requestId: string }
    if (spawnReq?.type !== 'pty-spawn') throw new Error('expected pty-spawn')
    worker.emit('message', {
      type: 'pty-spawn-result',
      requestId: spawnReq.requestId,
      ok: true,
      ptySessionId: 'pty_abc',
      processName: 'zsh',
    } satisfies PtyWorkerMessage)

    const handle = { ptySessionId: 'pty_abc' }
    const a = vi.fn()
    const b = vi.fn()
    const disposeA = supervisor.onData(handle, a)
    supervisor.onData(handle, b)
    disposeA.dispose()

    worker.emit('message', { type: 'pty-data', ptySessionId: 'pty_abc', data: 'hello' } satisfies PtyWorkerMessage)
    expect(a).not.toHaveBeenCalled()
    expect(b).toHaveBeenCalledWith('hello')
  })

  test('pty-exit dispatches to exit listeners and cleans up the session entry', () => {
    const supervisor = buildSupervisor(worker)
    void supervisor.spawn({ cwd: '/repo', cols: 80, rows: 24 })
    const spawnReq = worker.sent[0] as { type: string; requestId: string }
    if (spawnReq?.type !== 'pty-spawn') throw new Error('expected pty-spawn')
    worker.emit('message', {
      type: 'pty-spawn-result',
      requestId: spawnReq.requestId,
      ok: true,
      ptySessionId: 'pty_abc',
      processName: 'zsh',
    } satisfies PtyWorkerMessage)

    const handle = { ptySessionId: 'pty_abc' }
    const exit = vi.fn()
    supervisor.onExit(handle, exit)
    expect(supervisor.processName(handle)).toBe('zsh')

    worker.emit('message', {
      type: 'pty-exit',
      ptySessionId: 'pty_abc',
      code: null,
      signal: null,
    } satisfies PtyWorkerMessage)
    expect(exit).toHaveBeenCalledWith(null, null)
    // After exit the session is gone — processName returns the default.
    expect(supervisor.processName(handle)).toBe('terminal')
  })

  test('pty-process-name-changed updates the cached processName', () => {
    const supervisor = buildSupervisor(worker)
    void supervisor.spawn({ cwd: '/repo', cols: 80, rows: 24 })
    const spawnReq = worker.sent[0] as { type: string; requestId: string }
    if (spawnReq?.type !== 'pty-spawn') throw new Error('expected pty-spawn')
    worker.emit('message', {
      type: 'pty-spawn-result',
      requestId: spawnReq.requestId,
      ok: true,
      ptySessionId: 'pty_abc',
      processName: 'zsh',
    } satisfies PtyWorkerMessage)

    const handle = { ptySessionId: 'pty_abc' }
    expect(supervisor.processName(handle)).toBe('zsh')

    worker.emit('message', {
      type: 'pty-process-name-changed',
      ptySessionId: 'pty_abc',
      processName: 'vim',
    } satisfies PtyWorkerMessage)
    expect(supervisor.processName(handle)).toBe('vim')
  })

  test('rejects in-flight spawns and fires exit listeners when the worker crashes', async () => {
    const supervisor = buildSupervisor(worker)
    const promise = supervisor.spawn({ cwd: '/repo', cols: 80, rows: 24 })
    const handle = { ptySessionId: 'pty_abc' }
    const exit = vi.fn()
    supervisor.onExit(handle, exit)

    worker.emit('exit', 1, null)

    await expect(promise).resolves.toEqual({ ok: false, message: 'PTY worker exited' })
    expect(exit).toHaveBeenCalledWith(null, null)
  })

  test('restarts the worker with backoff when sessions are still active', async () => {
    vi.useFakeTimers()
    const workerA = new FakeWorker()
    const workerB = new FakeWorker()
    const workers = [workerA, workerB]
    const supervisor = new WorkerBackedPtySupervisor({
      workerEntry: '/tmp/pty-worker.js',
      spawnWorker: () => workers.shift() as never,
      setTimer: setTimeout,
      clearTimer: clearTimeout,
    })

    // Establish an active session by completing a spawn round-trip.
    const promise = supervisor.spawn({ cwd: '/repo', cols: 80, rows: 24 })
    const request = workerA.sent[0] as { type: string; requestId: string }
    if (request?.type !== 'pty-spawn') throw new Error('expected pty-spawn')
    workerA.emit('message', {
      type: 'pty-spawn-result',
      requestId: request.requestId,
      ok: true,
      ptySessionId: 'pty_abc',
      processName: 'zsh',
    } satisfies PtyWorkerMessage)
    await promise

    expect(supervisor.getDiagnostics().state).toBe('running')
    workerA.emit('exit', 1, null)
    expect(supervisor.getDiagnostics().state).toBe('restarting')

    await vi.advanceTimersByTimeAsync(249)
    expect(supervisor.getDiagnostics().state).toBe('restarting')

    await vi.advanceTimersByTimeAsync(1)
    expect(supervisor.getDiagnostics().state).toBe('running')
    expect(workerB.sent).toEqual([]) // No message sent before the session re-registers
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
    const request = worker.sent[0] as { type: string; requestId: string }
    if (request?.type !== 'pty-spawn') throw new Error('expected pty-spawn')
    worker.emit('message', {
      type: 'pty-spawn-result',
      requestId: request.requestId,
      ok: true,
      ptySessionId: 'pty_abc',
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
  })

  test("'error' from the worker is treated like an exit: pending spawns rejected, exit listeners fired, failure recorded", async () => {
    const supervisor = buildSupervisor(worker)
    const promise = supervisor.spawn({ cwd: '/repo', cols: 80, rows: 24 })
    const handle = { ptySessionId: 'pty_abc' }
    const exit = vi.fn()
    supervisor.onExit(handle, exit)

    worker.emit('error', new Error('worker exploded'))

    await expect(promise).resolves.toEqual({ ok: false, message: 'worker exploded' })
    expect(exit).toHaveBeenCalledWith(null, null)
    expect(supervisor.getDiagnostics().lastFailure).toEqual(
      expect.objectContaining({ kind: 'error', detail: 'worker exploded' }),
    )
  })
})
