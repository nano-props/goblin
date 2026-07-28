// Tests for the main-side PTY worker IPC bridge: events and worker lifecycle.

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { flushMicrotasks } from '#/test-utils/microtasks.ts'
import { WorkerBackedPtySupervisor } from '#/server/terminal/pty-supervisor-worker.ts'
import type { PtyWorkerMessage } from '#/server/terminal/pty-worker-protocol.ts'
import {
  buildSupervisor,
  FakeWorker,
  type SpawnRequest,
  spawnSession,
} from '#/server/test-utils/pty-supervisor-worker.ts'

describe('WorkerBackedPtySupervisor events and worker lifecycle', () => {
  let worker: FakeWorker

  beforeEach(() => {
    worker = new FakeWorker()
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
    await flushMicrotasks()
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

  test('retires the worker when a kill send throws synchronously', async () => {
    const supervisor = buildSupervisor(worker)
    const handle = await spawnSession(supervisor, worker)
    worker.sendError = new Error('IPC channel closed')

    expect(() => supervisor.kill(handle)).not.toThrow()

    expect(worker.killed).toBe(true)
    expect(supervisor.getDiagnostics()).toMatchObject({
      state: 'idle',
      workerRunning: false,
      lastFailure: {
        kind: 'send-failed',
        detail: `action=pty-kill ptySessionId=${handle.ptySessionId}`,
      },
    })
  })

  test('retires the worker when IPC asynchronously rejects a kill send', async () => {
    const supervisor = buildSupervisor(worker)
    const handle = await spawnSession(supervisor, worker)
    worker.sendCallbackError = new Error('IPC channel closed')

    await expect(supervisor.killAndWait(handle)).resolves.toBeUndefined()

    expect(worker.killed).toBe(true)
    expect(supervisor.getDiagnostics()).toMatchObject({
      state: 'idle',
      workerRunning: false,
      lastFailure: {
        kind: 'send-failed',
        detail: `action=pty-kill ptySessionId=${handle.ptySessionId}`,
      },
    })
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
      consecutiveWorkerInvalidations: 0,
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
      consecutiveWorkerInvalidations: 1,
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
