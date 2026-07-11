import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { TerminalPtyRuntime } from '#/server/terminal/terminal-pty-runtime.ts'

const runtimeMocks = vi.hoisted(() => ({
  spawn: vi.fn(),
}))

vi.mock('#/server/terminal/terminal-pty-runtime.ts', () => ({
  spawnTerminalPtyRuntime: runtimeMocks.spawn,
}))

import { createInProcessPtySupervisor } from '#/server/terminal/pty-supervisor-inprocess.ts'

const SPAWN_INPUT = { cwd: '/repo', cols: 80, rows: 24 }

interface FakeRuntime {
  runtime: TerminalPtyRuntime
  emitExit(): void
  exitDisposable: { dispose: ReturnType<typeof vi.fn> }
  kill: ReturnType<typeof vi.fn>
  onExit: ReturnType<typeof vi.fn>
}

describe('createInProcessPtySupervisor', () => {
  beforeEach(() => {
    runtimeMocks.spawn.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('installs one supervisor-owned exit observer before returning the spawned handle', async () => {
    const fake = createFakeRuntime()
    runtimeMocks.spawn.mockReturnValue({ ok: true, runtime: fake.runtime })
    const supervisor = createInProcessPtySupervisor()

    const result = await supervisor.spawn(SPAWN_INPUT)

    expect(result.ok).toBe(true)
    expect(fake.onExit).toHaveBeenCalledOnce()
    if (!result.ok) throw new Error(result.message)
    const publicExit = vi.fn()
    supervisor.onExit(result.handle, publicExit)
    expect(fake.onExit).toHaveBeenCalledOnce()

    fake.emitExit()
    await Promise.resolve()

    expect(publicExit).toHaveBeenCalledWith(null, null)
    expect(fake.exitDisposable.dispose).toHaveBeenCalledOnce()
    expect(supervisor.processName(result.handle)).toBe('terminal')
  })

  test('coalesces concurrent kill waiters onto one kill operation', async () => {
    const fake = createFakeRuntime()
    runtimeMocks.spawn.mockReturnValue({ ok: true, runtime: fake.runtime })
    const supervisor = createInProcessPtySupervisor()
    const result = await supervisor.spawn(SPAWN_INPUT)
    if (!result.ok) throw new Error(result.message)

    const first = supervisor.killAndWait(result.handle)
    const second = supervisor.killAndWait(result.handle)

    expect(fake.kill).toHaveBeenCalledOnce()
    fake.emitExit()
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined])
  })

  test('keeps the owner observer after timeout so late exit cleans the entry and retry succeeds', async () => {
    vi.useFakeTimers()
    const fake = createFakeRuntime()
    runtimeMocks.spawn.mockReturnValue({ ok: true, runtime: fake.runtime })
    const supervisor = createInProcessPtySupervisor()
    const result = await supervisor.spawn(SPAWN_INPUT)
    if (!result.ok) throw new Error(result.message)

    const closing = supervisor.killAndWait(result.handle)
    const timeout = expect(closing).rejects.toThrow('PTY close timed out')
    await vi.advanceTimersByTimeAsync(2_000)
    await timeout

    expect(fake.exitDisposable.dispose).not.toHaveBeenCalled()
    fake.emitExit()
    await Promise.resolve()

    expect(fake.exitDisposable.dispose).toHaveBeenCalledOnce()
    await expect(supervisor.killAndWait(result.handle)).resolves.toBeUndefined()
    expect(fake.kill).toHaveBeenCalledOnce()
  })

  test('starts one new kill attempt when retrying before a timed-out PTY exits', async () => {
    vi.useFakeTimers()
    const fake = createFakeRuntime()
    runtimeMocks.spawn.mockReturnValue({ ok: true, runtime: fake.runtime })
    const supervisor = createInProcessPtySupervisor()
    const result = await supervisor.spawn(SPAWN_INPUT)
    if (!result.ok) throw new Error(result.message)

    const firstTimeout = expect(supervisor.killAndWait(result.handle)).rejects.toThrow('PTY close timed out')
    await vi.advanceTimersByTimeAsync(2_000)
    await firstTimeout

    const retry = supervisor.killAndWait(result.handle)
    expect(fake.kill).toHaveBeenCalledTimes(2)
    fake.emitExit()
    await expect(retry).resolves.toBeUndefined()
  })

  test('kills the runtime and returns a spawn failure when owner observer registration throws', async () => {
    const fake = createFakeRuntime({ observerError: new Error('observer unavailable') })
    runtimeMocks.spawn.mockReturnValue({ ok: true, runtime: fake.runtime })
    const supervisor = createInProcessPtySupervisor()

    await expect(supervisor.spawn(SPAWN_INPUT)).resolves.toEqual({ ok: false, message: 'observer unavailable' })
    expect(fake.kill).toHaveBeenCalledOnce()
    expect(supervisor.getDiagnostics().state).toBe('idle')
  })

  test('replays a synchronous spawn-time exit to a later public subscriber', async () => {
    const fake = createFakeRuntime({ exitDuringSubscribe: true })
    runtimeMocks.spawn.mockReturnValue({ ok: true, runtime: fake.runtime })
    const supervisor = createInProcessPtySupervisor()
    const result = await supervisor.spawn(SPAWN_INPUT)
    if (!result.ok) throw new Error(result.message)
    const exit = vi.fn()

    const subscription = supervisor.onExit(result.handle, exit)
    await Promise.resolve()

    expect(exit).toHaveBeenCalledWith(null, null)
    expect(fake.exitDisposable.dispose).toHaveBeenCalledOnce()
    subscription.dispose()
  })
})

function createFakeRuntime(
  options: { observerError?: Error; exitDuringSubscribe?: boolean } = {},
): FakeRuntime {
  let exitListener: (() => void) | null = null
  const exitDisposable = { dispose: vi.fn() }
  const kill = vi.fn()
  const onExit = vi.fn((listener: () => void) => {
    if (options.observerError) throw options.observerError
    exitListener = listener
    if (options.exitDuringSubscribe) listener()
    return exitDisposable
  })
  return {
    runtime: {
      write: vi.fn(),
      resize: vi.fn(),
      kill,
      onData: vi.fn(() => ({ dispose: vi.fn() })),
      onExit,
      processName: vi.fn(() => 'zsh'),
    },
    emitExit() {
      exitListener?.()
    },
    exitDisposable,
    kill,
    onExit,
  }
}
