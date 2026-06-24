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
  pid = 4242

  send(message: unknown): boolean {
    this.sent.push(message)
    return this.sendResult
  }

  kill(): void {
    this.killed = true
  }

  disconnect(): void {}
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
    } satisfies PtyWorkerMessage)

    await expect(promise).resolves.toEqual({ ok: false, message: 'spawn failed' })
  })

  test('write/resize/kill translate to the matching IPC messages', () => {
    const supervisor = buildSupervisor(worker)
    // Force a spawn so the supervisor is initialized
    void supervisor.spawn({ cwd: '/repo', cols: 80, rows: 24 })
    const handle = { ptySessionId: 'pty_abc' }
    supervisor.write(handle, 'ls\n')
    supervisor.resize(handle, 100, 30)
    supervisor.kill(handle)

    expect(worker.sent.slice(1)).toEqual([
      { type: 'pty-write', ptySessionId: 'pty_abc', data: 'ls\n' },
      { type: 'pty-resize', ptySessionId: 'pty_abc', cols: 100, rows: 30 },
      { type: 'pty-kill', ptySessionId: 'pty_abc' },
    ])
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
