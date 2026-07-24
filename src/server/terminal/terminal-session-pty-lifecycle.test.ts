import { describe, expect, test, vi } from 'vitest'
import {
  TerminalPtyBinding,
  type TerminalPtyBindingAdmission,
  type TerminalPtyBindingEvents,
  type TerminalPtyMutationAdmission,
  type TerminalPtySessionState,
} from '#/server/terminal/terminal-session-pty-lifecycle.ts'
import {
  createPtyHandle,
  type PtyEventLease,
  type PtyHandle,
  type PtySpawnResult,
  type PtySupervisor,
} from '#/server/terminal/pty-supervisor.ts'
import { createPtyEventChannel } from '#/server/terminal/pty-event-lease.ts'
import type { TerminalWriteResult } from '#/shared/terminal-types.ts'

const ACCEPT_BINDING_FOR_TEST: TerminalPtyBindingAdmission = {
  commit: () => {},
  rollback: () => {},
}

const ACCEPT_MUTATION_FOR_TEST: TerminalPtyMutationAdmission = {
  validate: () => true,
  commit: () => true,
}

describe('TerminalPtyBinding aborted spawn retirement', () => {
  test('retains a late handle after the first kill fails so later retirement can retry', async () => {
    const deferredSpawn = Promise.withResolvers<PtySpawnResult>()
    const killAndWait = vi
      .fn<(handle: PtyHandle) => Promise<void>>()
      .mockRejectedValueOnce(new Error('PTY close timed out'))
      .mockResolvedValue(undefined)
    const supervisor = {
      mode: 'in-process',
      spawn: vi.fn(async () => await deferredSpawn.promise),
      write: vi.fn(async () => ({ status: 'accepted' as const })),
      resize: vi.fn(),
      kill: vi.fn(),
      waitForExit: vi.fn(() => new Promise<void>(() => {})),
      killAndWait,
      getDiagnostics: vi.fn(),
      shutdown: vi.fn(),
    } satisfies PtySupervisor
    const events = {
      isSessionLive: vi.fn(() => true),
      emitLifecycle: vi.fn(),
      emitOutput: vi.fn(),
      emitBell: vi.fn(),
      emitTitle: vi.fn(),
      emitExit: vi.fn(),
      confirmedExit: vi.fn(),
    } satisfies TerminalPtyBindingEvents<TerminalPtySessionState<string>>
    const binding = new TerminalPtyBinding(supervisor, events)
    const session: TerminalPtySessionState<string> = {
      id: 'pty_runtime_late_123456',
      userId: 'user-test',
      cwd: '/repo/worktree',
      phase: 'opening',
      message: null,
      ptyState: { kind: 'prepared' },
    }
    const runtime = new AbortController()

    const spawn = binding.spawn(session, 80, 24, ACCEPT_BINDING_FOR_TEST, runtime.signal)
    runtime.abort(new Error('error.workspace-runtime-stale'))
    await expect(spawn).resolves.toMatchObject({
      generation: 1,
      result: { ok: false, message: 'error.workspace-runtime-stale' },
    })

    const lateHandle = createPtyHandle('pty_late_handle_123456')
    deferredSpawn.resolve({
      ok: true,
      handle: lateHandle,
      processName: 'zsh',
      events: createPtyEventChannel().lease,
    })
    await vi.waitFor(() => expect(killAndWait).toHaveBeenCalledTimes(1))

    await expect(binding.disposeAndWait(session)).rejects.toThrow('PTY close timed out')

    await binding.disposeAndWait(session)
    expect(killAndWait).toHaveBeenCalledTimes(2)
    await binding.disposeAndWait(session)
    expect(killAndWait).toHaveBeenCalledTimes(2)
  })

  test('does not start a fresh retry until an aborted native candidate is retired', async () => {
    const firstNativeSpawn = Promise.withResolvers<PtySpawnResult>()
    const secondNativeSpawn = Promise.withResolvers<PtySpawnResult>()
    const killAcknowledged = Promise.withResolvers<void>()
    const supervisor = createDeferredSupervisor([firstNativeSpawn.promise, secondNativeSpawn.promise])
    supervisor.killAndWait = vi.fn(async () => await killAcknowledged.promise)
    const { binding, session } = createPreparedBinding(supervisor)
    const abortController = new AbortController()

    const first = binding.spawn(session, 80, 24, ACCEPT_BINDING_FOR_TEST, abortController.signal)
    await vi.waitFor(() => expect(supervisor.spawn).toHaveBeenCalledOnce())
    abortController.abort()
    await expect(first).resolves.toMatchObject({ result: { ok: false, message: 'error.workspace-runtime-stale' } })

    const retry = binding.spawn(session, 100, 30, ACCEPT_BINDING_FOR_TEST)
    firstNativeSpawn.resolve(ptySuccess('pty_aborted_candidate_123456'))
    await vi.waitFor(() => expect(supervisor.killAndWait).toHaveBeenCalledOnce())
    expect(supervisor.spawn).toHaveBeenCalledOnce()

    killAcknowledged.resolve()
    await vi.waitFor(() => expect(supervisor.spawn).toHaveBeenCalledTimes(2))
    secondNativeSpawn.resolve(ptySuccess('pty_fresh_retry_123456'))
    await expect(retry).resolves.toMatchObject({ result: { ok: true } })
    expect(session.ptyState).toMatchObject({ kind: 'bound', generation: 1, cols: 100, rows: 30 })
  })

  test('releases an aborted ownership barrier when worker disconnect settles the native spawn', async () => {
    const disconnectedSpawn = Promise.withResolvers<PtySpawnResult>()
    const retrySpawn = Promise.withResolvers<PtySpawnResult>()
    const supervisor = createDeferredSupervisor([disconnectedSpawn.promise, retrySpawn.promise])
    const { binding, session } = createPreparedBinding(supervisor)
    const abortController = new AbortController()

    const first = binding.spawn(session, 80, 24, ACCEPT_BINDING_FOR_TEST, abortController.signal)
    await vi.waitFor(() => expect(supervisor.spawn).toHaveBeenCalledOnce())
    abortController.abort()
    await expect(first).resolves.toMatchObject({ result: { ok: false, message: 'error.workspace-runtime-stale' } })

    const retry = binding.spawn(session, 100, 30, ACCEPT_BINDING_FOR_TEST)
    expect(supervisor.spawn).toHaveBeenCalledOnce()

    disconnectedSpawn.resolve({ ok: false, message: 'PTY worker disconnected' })
    await vi.waitFor(() => expect(supervisor.spawn).toHaveBeenCalledTimes(2))
    retrySpawn.resolve(ptySuccess('pty_after_worker_disconnect_123456'))

    await expect(retry).resolves.toMatchObject({ result: { ok: true } })
    expect(session.ptyState).toMatchObject({ kind: 'bound', generation: 1, cols: 100, rows: 30 })
  })

  test('returns an adoption retirement failure and drains it before a fresh retry', async () => {
    const secondNativeSpawn = Promise.withResolvers<PtySpawnResult>()
    const retryKillAcknowledged = Promise.withResolvers<void>()
    const supervisor = createDeferredSupervisor([
      Promise.resolve(ptySuccess('pty_rejected_candidate_123456')),
      secondNativeSpawn.promise,
    ])
    supervisor.killAndWait = vi
      .fn<(handle: PtyHandle) => Promise<void>>()
      .mockRejectedValueOnce(new Error('PTY close timed out'))
      .mockImplementationOnce(async () => await retryKillAcknowledged.promise)
    const { binding, session } = createPreparedBinding(supervisor)

    await expect(
      binding.spawn(session, 80, 24, {
        commit() {
          throw new Error('error.unavailable')
        },
        rollback: vi.fn(),
      }),
    ).resolves.toMatchObject({ result: { ok: false, message: 'PTY close timed out' } })
    expect(session.ptyState).toEqual({ kind: 'prepared' })

    const retry = binding.spawn(session, 100, 30, ACCEPT_BINDING_FOR_TEST)
    await vi.waitFor(() => expect(supervisor.killAndWait).toHaveBeenCalledTimes(2))
    expect(supervisor.spawn).toHaveBeenCalledOnce()

    retryKillAcknowledged.resolve()
    await vi.waitFor(() => expect(supervisor.spawn).toHaveBeenCalledTimes(2))
    secondNativeSpawn.resolve(ptySuccess('pty_after_retirement_retry_123456'))
    await expect(retry).resolves.toMatchObject({ result: { ok: true } })
  })
})

describe('TerminalPtyBinding detached retirement', () => {
  test('keeps ownership after bounded close timeout until durable native exit', async () => {
    const eventualExit = Promise.withResolvers<void>()
    const { binding, session, supervisor } = await createBoundBinding(async () => ({ status: 'accepted' }))
    supervisor.waitForExit = vi.fn(async () => await eventualExit.promise)
    supervisor.killAndWait = vi.fn(async () => {
      throw new Error('PTY close timed out')
    })
    let disposed = false

    const disposal = binding.disposeDetachedAndWait(session).then(() => {
      disposed = true
    })
    expect(session.ptyState.kind === 'bound' && session.ptyState.render.screen.disposed).toBe(true)
    await vi.waitFor(() => expect(supervisor.killAndWait).toHaveBeenCalledOnce())
    await Promise.resolve()
    expect(disposed).toBe(false)

    eventualExit.resolve()
    await disposal
    expect(disposed).toBe(true)
  })
})

describe('TerminalPtyBinding input acknowledgement', () => {
  test('settles every microtask-batched caller from the supervisor result', async () => {
    const deferredWrite = Promise.withResolvers<TerminalWriteResult>()
    const { binding, session, supervisor } = await createBoundBinding(() => deferredWrite.promise)

    const first = binding.write(session, 'a')
    const second = binding.write(session, 'b')
    await Promise.resolve()

    expect(supervisor.write).toHaveBeenCalledWith({ ptySessionId: 'pty_bound_123456' }, 'ab')
    deferredWrite.resolve({ status: 'accepted' })
    await expect(Promise.all([first, second])).resolves.toEqual([{ status: 'accepted' }, { status: 'accepted' }])
  })

  test('settles an in-flight old-handle batch as indeterminate on disposal', async () => {
    const deferredWrite = Promise.withResolvers<TerminalWriteResult>()
    const { binding, session } = await createBoundBinding(() => deferredWrite.promise)
    const write = binding.write(session, 'input')
    await Promise.resolve()

    binding.dispose(session)

    await expect(write).resolves.toEqual({ status: 'indeterminate' })
    deferredWrite.resolve({ status: 'accepted' })
    await Promise.resolve()
  })

  test('rejects queued input before restart can bind a replacement handle', async () => {
    const supervisor = createDeferredSupervisor([
      Promise.resolve(ptySuccess('pty_input_old_123456')),
      Promise.resolve(ptySuccess('pty_input_replacement_123456')),
    ])
    const { binding, session } = createPreparedBinding(supervisor)
    await expect(binding.spawn(session, 80, 24, ACCEPT_BINDING_FOR_TEST)).resolves.toMatchObject({
      result: { ok: true },
    })

    const queuedWrite = binding.write(session, 'old queued input')
    await expect(binding.restart(session, 100, 30, ACCEPT_BINDING_FOR_TEST)).resolves.toMatchObject({
      generation: 2,
      result: { ok: true },
    })

    await expect(queuedWrite).resolves.toEqual({ status: 'rejected' })
    expect(supervisor.write).not.toHaveBeenCalled()

    await expect(binding.write(session, 'replacement input')).resolves.toEqual({ status: 'accepted' })
    expect(supervisor.write).toHaveBeenCalledOnce()
    expect(supervisor.write).toHaveBeenCalledWith({ ptySessionId: 'pty_input_replacement_123456' }, 'replacement input')
  })

  test('keeps an in-flight old-generation write pinned to its captured handle across restart', async () => {
    const oldWriteAcknowledged = Promise.withResolvers<TerminalWriteResult>()
    const supervisor = createDeferredSupervisor([
      Promise.resolve(ptySuccess('pty_input_inflight_old_123456')),
      Promise.resolve(ptySuccess('pty_input_inflight_replacement_123456')),
    ])
    vi.mocked(supervisor.write)
      .mockImplementationOnce(async () => await oldWriteAcknowledged.promise)
      .mockResolvedValue({ status: 'accepted' })
    const { binding, session } = createPreparedBinding(supervisor)
    await expect(binding.spawn(session, 80, 24, ACCEPT_BINDING_FOR_TEST)).resolves.toMatchObject({
      result: { ok: true },
    })

    const oldWrite = binding.write(session, 'old in-flight input')
    await vi.waitFor(() =>
      expect(supervisor.write).toHaveBeenCalledWith(
        { ptySessionId: 'pty_input_inflight_old_123456' },
        'old in-flight input',
      ),
    )

    await expect(binding.restart(session, 100, 30, ACCEPT_BINDING_FOR_TEST)).resolves.toMatchObject({
      generation: 2,
      result: { ok: true },
    })
    await expect(oldWrite).resolves.toEqual({ status: 'indeterminate' })

    oldWriteAcknowledged.resolve({ status: 'accepted' })
    await Promise.resolve()
    await expect(binding.write(session, 'replacement input')).resolves.toEqual({ status: 'accepted' })

    expect(supervisor.write).toHaveBeenCalledTimes(2)
    expect(supervisor.write).toHaveBeenLastCalledWith(
      { ptySessionId: 'pty_input_inflight_replacement_123456' },
      'replacement input',
    )
  })
})

describe('TerminalPtyBinding geometry boundary', () => {
  test('does not publish canonical geometry or a recovery snapshot before native resize is acknowledged', async () => {
    const nativeResize = Promise.withResolvers<boolean>()
    const { binding, session, supervisor } = await createBoundBinding(
      async () => ({ status: 'accepted' }),
      async () => await nativeResize.promise,
    )

    const resize = binding.resize(session, 1, 100, 30, ACCEPT_MUTATION_FOR_TEST)
    const snapshot = binding.recoveryAttach(session, 1, 100, 30, {
      prepare: () => 'preserve',
      commit: () => true,
    })
    let snapshotSettled = false
    void snapshot.then(() => {
      snapshotSettled = true
    })
    await Promise.resolve()

    expect(supervisor.resize).toHaveBeenCalledWith({ ptySessionId: 'pty_bound_123456' }, 100, 30)
    expect(session.ptyState).toMatchObject({ kind: 'bound', cols: 80, rows: 24 })
    expect(snapshotSettled).toBe(false)

    nativeResize.resolve(true)
    await expect(resize).resolves.toEqual({ accepted: true, changed: true })
    await expect(snapshot).resolves.toMatchObject({
      accepted: true,
      changed: false,
      snapshot: {
        generation: 1,
        canonicalSize: { cols: 100, rows: 30 },
      },
    })
  })

  test('keeps canonical geometry unchanged when native resize is rejected', async () => {
    const { binding, session } = await createBoundBinding(
      async () => ({ status: 'accepted' }),
      async () => false,
    )

    await expect(binding.resize(session, 1, 100, 30, ACCEPT_MUTATION_FOR_TEST)).resolves.toEqual({
      accepted: false,
      changed: false,
    })
    expect(session.ptyState).toMatchObject({ kind: 'bound', cols: 80, rows: 24 })
  })

  test('normalizes a rejected native resize and remains usable for the next proposal', async () => {
    const { binding, session, supervisor } = await createBoundBinding(async () => ({ status: 'accepted' }))
    vi.mocked(supervisor.resize).mockRejectedValueOnce(new Error('worker unavailable')).mockResolvedValueOnce(true)

    await expect(binding.resize(session, 1, 100, 30, ACCEPT_MUTATION_FOR_TEST)).resolves.toEqual({
      accepted: false,
      changed: false,
    })
    expect(session.ptyState).toMatchObject({ kind: 'bound', cols: 80, rows: 24 })

    await expect(binding.resize(session, 1, 120, 40, ACCEPT_MUTATION_FOR_TEST)).resolves.toEqual({
      accepted: true,
      changed: true,
    })
    expect(session.ptyState).toMatchObject({ kind: 'bound', cols: 120, rows: 40 })
  })

  test('does not issue a native resize for the already-canonical geometry', async () => {
    const { binding, session, supervisor } = await createBoundBinding(async () => ({ status: 'accepted' }))

    await expect(binding.resize(session, 1, 80, 24, ACCEPT_MUTATION_FOR_TEST)).resolves.toEqual({
      accepted: true,
      changed: false,
    })
    expect(supervisor.resize).not.toHaveBeenCalled()
  })

  test('rejects an old-generation resize acknowledgement after restart publishes a replacement binding', async () => {
    const nativeResize = Promise.withResolvers<boolean>()
    const { binding, session } = await createBoundBinding(
      async () => ({ status: 'accepted' }),
      async () => await nativeResize.promise,
    )

    const resize = binding.resize(session, 1, 100, 30, ACCEPT_MUTATION_FOR_TEST)
    await Promise.resolve()
    expect(session.ptyState).toMatchObject({ kind: 'bound', generation: 1, cols: 80, rows: 24 })

    await expect(binding.restart(session, 120, 40, ACCEPT_BINDING_FOR_TEST)).resolves.toMatchObject({
      generation: 2,
      result: { ok: true },
    })
    expect(session.ptyState).toMatchObject({ kind: 'bound', generation: 2, cols: 120, rows: 40 })

    nativeResize.resolve(true)
    await expect(resize).resolves.toEqual({ accepted: false, changed: false })
    expect(session.ptyState).toMatchObject({ kind: 'bound', generation: 2, cols: 120, rows: 40 })
  })

  test('rejects a native resize acknowledgement after the binding starts closing', async () => {
    const nativeResize = Promise.withResolvers<boolean>()
    const { binding, session } = await createBoundBinding(
      async () => ({ status: 'accepted' }),
      async () => await nativeResize.promise,
    )

    const resize = binding.resize(session, 1, 100, 30, ACCEPT_MUTATION_FOR_TEST)
    await Promise.resolve()
    binding.dispose(session)

    nativeResize.resolve(true)
    await expect(resize).resolves.toEqual({ accepted: false, changed: false })
    expect(session.ptyState).toMatchObject({ kind: 'bound', activity: 'retained', cols: 80, rows: 24 })
  })
})

describe('TerminalPtyBinding adoption boundary', () => {
  test('fails a committed binding closed when output publication throws', async () => {
    const channel = createPtyEventChannel()
    const handle = createPtyHandle('pty_observer_failure_123456')
    const supervisor = createChannelSupervisor(channel.lease, handle)
    const emitLifecycle = vi.fn()
    const binding = new TerminalPtyBinding(supervisor, {
      isSessionLive: () => true,
      emitLifecycle,
      emitOutput: () => {
        throw new Error('output sink failed')
      },
      emitBell: vi.fn(),
      emitTitle: vi.fn(),
      emitExit: vi.fn(),
      confirmedExit: vi.fn(),
    })
    const session: TerminalPtySessionState<string> = {
      id: 'pty_runtime_observer_failure_123456',
      userId: 'user-test',
      cwd: '/repo/worktree',
      phase: 'opening',
      message: null,
      ptyState: { kind: 'prepared' },
    }

    await expect(binding.spawn(session, 80, 24, ACCEPT_BINDING_FOR_TEST)).resolves.toMatchObject({
      result: { ok: true },
    })
    expect(() => channel.sink.data({ data: 'output', processName: 'zsh' })).not.toThrow()

    expect(session).toMatchObject({
      phase: 'error',
      message: 'error.unavailable',
      ptyState: { kind: 'bound', generation: 1, activity: 'retained' },
    })
    expect(session.ptyState.kind === 'bound' && session.ptyState.render.screen.disposed).toBe(true)
    expect(supervisor.kill).toHaveBeenCalledWith(handle)
    await expect(binding.write(session, 'rejected input')).resolves.toEqual({ status: 'rejected' })
    expect(emitLifecycle).toHaveBeenLastCalledWith(session)
  })

  test('does not roll admission back when buffered output fails after commit', async () => {
    const channel = createPtyEventChannel()
    channel.sink.data({ data: 'startup output', processName: 'zsh' })
    const handle = createPtyHandle('pty_buffered_observer_failure_123456')
    const supervisor = createChannelSupervisor(channel.lease, handle)
    const admission = { commit: vi.fn(), rollback: vi.fn() }
    const binding = new TerminalPtyBinding(supervisor, {
      isSessionLive: () => true,
      emitLifecycle: vi.fn(),
      emitOutput: () => {
        throw new Error('output sink failed')
      },
      emitBell: vi.fn(),
      emitTitle: vi.fn(),
      emitExit: vi.fn(),
      confirmedExit: vi.fn(),
    })
    const session: TerminalPtySessionState<string> = {
      id: 'pty_runtime_buffered_observer_failure_123456',
      userId: 'user-test',
      cwd: '/repo/worktree',
      phase: 'opening',
      message: null,
      ptyState: { kind: 'prepared' },
    }

    await expect(binding.spawn(session, 80, 24, admission)).resolves.toMatchObject({
      result: { ok: false, message: 'error.unavailable' },
    })

    expect(admission.commit).toHaveBeenCalledOnce()
    expect(admission.rollback).not.toHaveBeenCalled()
    expect(session).toMatchObject({
      phase: 'error',
      message: 'error.unavailable',
      ptyState: { kind: 'bound', generation: 1, activity: 'retained' },
    })
    expect(supervisor.kill).toHaveBeenCalledWith(handle)
  })

  test('confirms native exit even when exit publication throws', async () => {
    const channel = createPtyEventChannel()
    const handle = createPtyHandle('pty_exit_publication_failure_123456')
    const supervisor = createChannelSupervisor(channel.lease, handle)
    const confirmedExit = vi.fn()
    const binding = new TerminalPtyBinding(supervisor, {
      isSessionLive: () => true,
      emitLifecycle: vi.fn(),
      emitOutput: vi.fn(),
      emitBell: vi.fn(),
      emitTitle: vi.fn(),
      emitExit: () => {
        throw new Error('exit sink failed')
      },
      confirmedExit,
    })
    const session: TerminalPtySessionState<string> = {
      id: 'pty_runtime_exit_publication_failure_123456',
      userId: 'user-test',
      cwd: '/repo/worktree',
      phase: 'opening',
      message: null,
      ptyState: { kind: 'prepared' },
    }

    await expect(binding.spawn(session, 80, 24, ACCEPT_BINDING_FOR_TEST)).resolves.toMatchObject({
      result: { ok: true },
    })
    expect(() => channel.sink.exit(0, null)).not.toThrow()
    expect(confirmedExit).toHaveBeenCalledWith(session, 1)
  })

  test('does not roll a replacement back after its buffered exit is published', async () => {
    let spawnCount = 0
    const supervisor = {
      mode: 'in-process',
      spawn: vi.fn(async () => {
        spawnCount += 1
        const events = createPtyEventChannel()
        if (spawnCount === 2) events.sink.exit(null, null)
        return {
          ok: true as const,
          handle: createPtyHandle(`pty_adoption_${spawnCount}`),
          processName: 'zsh',
          events: events.lease,
        }
      }),
      write: vi.fn(async () => ({ status: 'accepted' as const })),
      resize: vi.fn(async () => true),
      kill: vi.fn(),
      waitForExit: vi.fn(() => new Promise<void>(() => {})),
      killAndWait: vi.fn(async () => {}),
      getDiagnostics: vi.fn(),
      shutdown: vi.fn(),
    } satisfies PtySupervisor
    const confirmedExit = vi.fn()
    const events = {
      isSessionLive: vi.fn(() => true),
      emitLifecycle: vi.fn(),
      emitOutput: vi.fn(),
      emitBell: vi.fn(),
      emitTitle: vi.fn(),
      emitExit: vi.fn(),
      confirmedExit,
    } satisfies TerminalPtyBindingEvents<TerminalPtySessionState<string>>
    const binding = new TerminalPtyBinding(supervisor, events)
    const session: TerminalPtySessionState<string> = {
      id: 'pty_runtime_adoption_123456',
      userId: 'user-test',
      cwd: '/repo/worktree',
      phase: 'opening',
      message: null,
      ptyState: { kind: 'prepared' },
    }
    await binding.spawn(session, 80, 24, ACCEPT_BINDING_FOR_TEST)
    if (session.ptyState.kind !== 'bound') throw new Error('expected initial binding')
    const previousRender = session.ptyState.render

    await expect(binding.restart(session, 100, 30, ACCEPT_BINDING_FOR_TEST)).resolves.toMatchObject({
      generation: 2,
      result: { ok: false, message: 'error.unavailable' },
    })

    expect(session.ptyState).toMatchObject({ kind: 'bound', generation: 2, activity: 'retained' })
    expect(previousRender.screen.disposed).toBe(true)
    expect(confirmedExit).toHaveBeenCalledWith(session, 2)
  })
})

async function createBoundBinding(
  write: () => Promise<TerminalWriteResult>,
  resize: (cols: number, rows: number) => Promise<boolean> = unexpectedNativeResize,
) {
  const handle = createPtyHandle('pty_bound_123456')
  const supervisor = {
    mode: 'in-process',
    spawn: vi.fn(async () => ({
      ok: true as const,
      handle,
      processName: 'zsh',
      events: createPtyEventChannel().lease,
    })),
    write: vi.fn(write),
    resize: vi.fn(async (_handle, cols, rows) => await resize(cols, rows)),
    kill: vi.fn(),
    waitForExit: vi.fn(() => new Promise<void>(() => {})),
    killAndWait: vi.fn(async (_handle: PtyHandle) => {}),
    getDiagnostics: vi.fn(),
    shutdown: vi.fn(),
  } satisfies PtySupervisor
  const events = {
    isSessionLive: vi.fn(() => true),
    emitLifecycle: vi.fn(),
    emitOutput: vi.fn(),
    emitBell: vi.fn(),
    emitTitle: vi.fn(),
    emitExit: vi.fn(),
    confirmedExit: vi.fn(),
  } satisfies TerminalPtyBindingEvents<TerminalPtySessionState<string>>
  const binding = new TerminalPtyBinding(supervisor, events)
  const session: TerminalPtySessionState<string> = {
    id: 'pty_runtime_bound_123456',
    userId: 'user-test',
    cwd: '/repo/worktree',
    phase: 'opening',
    message: null,
    ptyState: { kind: 'prepared' },
  }
  const spawned = await binding.spawn(session, 80, 24, ACCEPT_BINDING_FOR_TEST)
  expect(spawned.result).toEqual({ ok: true })
  return { binding, session, supervisor }
}

async function unexpectedNativeResize(): Promise<never> {
  throw new Error('Unexpected native PTY resize in test')
}

function createDeferredSupervisor(spawns: readonly Promise<PtySpawnResult>[]) {
  let spawnIndex = 0
  return {
    mode: 'in-process' as const,
    spawn: vi.fn(async () => await spawns[spawnIndex++]!),
    write: vi.fn(async () => ({ status: 'accepted' as const })),
    resize: vi.fn(async () => true),
    kill: vi.fn(),
    waitForExit: vi.fn(() => new Promise<void>(() => {})),
    killAndWait: vi.fn(async (_handle: PtyHandle) => {}),
    getDiagnostics: vi.fn(),
    shutdown: vi.fn(),
  } satisfies PtySupervisor
}

function createChannelSupervisor(events: PtyEventLease, handle: PtyHandle) {
  return {
    mode: 'in-process' as const,
    spawn: vi.fn(async () => ({ ok: true as const, handle, processName: 'zsh', events })),
    write: vi.fn(async () => ({ status: 'accepted' as const })),
    resize: vi.fn(async () => true),
    kill: vi.fn(),
    waitForExit: vi.fn(() => new Promise<void>(() => {})),
    killAndWait: vi.fn(async () => {}),
    getDiagnostics: vi.fn(),
    shutdown: vi.fn(),
  } satisfies PtySupervisor
}

function createPreparedBinding(supervisor: PtySupervisor) {
  const session: TerminalPtySessionState<string> = {
    id: 'pty_runtime_prepared_123456',
    userId: 'user-test',
    cwd: '/repo/worktree',
    phase: 'opening',
    message: null,
    ptyState: { kind: 'prepared' },
  }
  const binding = new TerminalPtyBinding(supervisor, {
    isSessionLive: () => true,
    emitLifecycle: vi.fn(),
    emitOutput: vi.fn(),
    emitBell: vi.fn(),
    emitTitle: vi.fn(),
    emitExit: vi.fn(),
    confirmedExit: vi.fn(),
  })
  return { binding, session }
}

function ptySuccess(ptySessionId: string): Extract<PtySpawnResult, { ok: true }> {
  return {
    ok: true,
    handle: createPtyHandle(ptySessionId),
    processName: 'zsh',
    events: createPtyEventChannel().lease,
  }
}
