import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Mock } from 'vitest'
import { useFakeTimers } from '#/test-utils/timers.ts'
import type {
  SpawnTerminalPtyRuntimeResult,
  TerminalPtyRuntime,
  TerminalPtyRuntimeEventObserver,
  TerminalPtyRuntimeEventOwnership,
} from '#/server/terminal/terminal-pty-runtime.ts'

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
  spawn(input: unknown, observer: TerminalPtyRuntimeEventObserver): SpawnTerminalPtyRuntimeResult
  events: TerminalPtyRuntimeEventOwnership & {
    dispose: Mock
    disposeData: Mock
  }
  emitData(data: string): void
  emitExit(): void
  kill: Mock
}

function installFakeRuntime(fake: FakeRuntime): void {
  runtimeMocks.spawn.mockImplementation(fake.spawn)
}

describe('createInProcessPtySupervisor', () => {
  beforeEach(() => {
    runtimeMocks.spawn.mockReset()
  })

  test('installs one supervisor-owned exit observer before returning the spawned handle', async () => {
    const { events, fake } = await spawnFakeSupervisor()
    expect(fake.spawn).toHaveBeenCalledOnce()
    const publicExit = vi.fn()
    const claim = events.claim({ onData: vi.fn(), onExit: publicExit })
    claim.activate()

    fake.emitExit()

    expect(publicExit).toHaveBeenCalledWith(null, null)
  })

  test('coalesces concurrent kill waiters onto one kill operation', async () => {
    const { fake, handle, supervisor } = await spawnFakeSupervisor()

    const first = supervisor.killAndWait(handle)
    const second = supervisor.killAndWait(handle)

    expect(fake.kill).toHaveBeenCalledOnce()
    fake.emitExit()
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined])
  })

  test('keeps the owner observer after timeout so late exit cleans the entry and retry succeeds', async () => {
    useFakeTimers()
    const { fake, handle, supervisor } = await spawnFakeSupervisor()

    const closing = supervisor.killAndWait(handle)
    const timeout = expect(closing).rejects.toThrow('PTY close timed out')
    await vi.advanceTimersByTimeAsync(2_000)
    await timeout

    expect(fake.events.dispose).not.toHaveBeenCalled()
    fake.emitExit()

    await expect(supervisor.killAndWait(handle)).resolves.toBeUndefined()
    expect(fake.kill).toHaveBeenCalledOnce()
  })

  test('keeps durable exit completion subscribed after a bounded close timeout', async () => {
    useFakeTimers()
    const { fake, handle, supervisor } = await spawnFakeSupervisor()
    let exitObserved = false
    const eventualExit = supervisor.waitForExit(handle).then(() => {
      exitObserved = true
    })

    const timeout = expect(supervisor.killAndWait(handle)).rejects.toThrow('PTY close timed out')
    await vi.advanceTimersByTimeAsync(2_000)
    await timeout
    expect(exitObserved).toBe(false)

    fake.emitExit()
    await eventualExit
    expect(exitObserved).toBe(true)
  })

  test('starts one new kill attempt when retrying before a timed-out PTY exits', async () => {
    useFakeTimers()
    const { fake, handle, supervisor } = await spawnFakeSupervisor()

    const firstTimeout = expect(supervisor.killAndWait(handle)).rejects.toThrow('PTY close timed out')
    await vi.advanceTimersByTimeAsync(2_000)
    await firstTimeout

    const retry = supervisor.killAndWait(handle)
    expect(fake.kill).toHaveBeenCalledTimes(2)
    fake.emitExit()
    await expect(retry).resolves.toBeUndefined()
  })

  test('propagates a structured native spawn failure without publishing a handle', async () => {
    runtimeMocks.spawn.mockReturnValue({ ok: false, message: 'observer unavailable' })
    const supervisor = createInProcessPtySupervisor()

    await expect(supervisor.spawn(SPAWN_INPUT)).resolves.toEqual({ ok: false, message: 'observer unavailable' })
    expect(supervisor.getDiagnostics().state).toBe('idle')
  })

  test('replays a synchronous spawn-time exit to a later public subscriber', async () => {
    const { events } = await spawnFakeSupervisor({ exitDuringSpawn: true })
    const exit = vi.fn()

    const subscription = events.claim({ onData: vi.fn(), onExit: exit })
    subscription.activate()

    expect(exit).toHaveBeenCalledWith(null, null)
    subscription.dispose()
  })

  test('replays synchronous spawn-time data to the first business owner', async () => {
    const { events } = await spawnFakeSupervisor({ dataDuringSpawn: 'early output' })
    const data = vi.fn()

    const subscription = events.claim({ onData: data, onExit: vi.fn() })
    subscription.activate()

    expect(data).toHaveBeenCalledWith({ data: 'early output', processName: 'zsh' })
    subscription.dispose()
  })

  test('confirms a runtime write and rejects a missing handle', async () => {
    const { fake, handle, supervisor } = await spawnFakeSupervisor()

    await expect(supervisor.write(handle, 'input')).resolves.toEqual({ status: 'accepted' })
    fake.emitExit()
    await expect(supervisor.write(handle, 'late')).resolves.toEqual({ status: 'rejected' })
  })

  test('marks a throwing native write as indeterminate', async () => {
    const fake = createFakeRuntime()
    vi.mocked(fake.runtime.write).mockImplementationOnce(() => {
      throw new Error('write failed')
    })
    installFakeRuntime(fake)
    const supervisor = createInProcessPtySupervisor()
    const result = await supervisor.spawn(SPAWN_INPUT)
    if (!result.ok) throw new Error(result.message)

    await expect(supervisor.write(result.handle, 'input')).resolves.toEqual({ status: 'indeterminate' })
  })

  test('does not allocate a native PTY after shutdown', async () => {
    const supervisor = createInProcessPtySupervisor()
    supervisor.shutdown()

    await expect(supervisor.spawn(SPAWN_INPUT)).resolves.toEqual({
      ok: false,
      message: 'PTY supervisor stopped',
    })
    expect(runtimeMocks.spawn).not.toHaveBeenCalled()
  })

  test('disconnects native event ownership before killing runtimes during shutdown', async () => {
    const { events, fake, handle, supervisor } = await spawnFakeSupervisor()
    const onData = vi.fn()
    const onExit = vi.fn()
    events.claim({ onData, onExit }).activate()
    const exited = supervisor.waitForExit(handle)

    supervisor.shutdown()
    fake.emitData('late')
    fake.emitExit()

    expect(fake.events.dispose.mock.invocationCallOrder[0]).toBeLessThan(fake.kill.mock.invocationCallOrder[0]!)
    expect(onData).not.toHaveBeenCalled()
    expect(onExit).not.toHaveBeenCalled()
    await expect(exited).resolves.toBeUndefined()
  })
})

async function spawnFakeSupervisor(options: { dataDuringSpawn?: string; exitDuringSpawn?: boolean } = {}) {
  const fake = createFakeRuntime(options)
  installFakeRuntime(fake)
  const supervisor = createInProcessPtySupervisor()
  const result = await supervisor.spawn(SPAWN_INPUT)
  if (!result.ok) throw new Error(result.message)
  return { events: result.events, fake, handle: result.handle, supervisor }
}

function createFakeRuntime(options: { dataDuringSpawn?: string; exitDuringSpawn?: boolean } = {}): FakeRuntime {
  let observer: TerminalPtyRuntimeEventObserver | null = null
  let dataEnabled = true
  let exitEnabled = true
  const kill = vi.fn()
  const disposeData = vi.fn(() => {
    dataEnabled = false
  })
  const dispose = vi.fn(() => {
    dataEnabled = false
    exitEnabled = false
  })
  const events = { disposeData, dispose }
  const runtime: TerminalPtyRuntime = {
    write: vi.fn(),
    resize: vi.fn(),
    kill,
    processName: vi.fn(() => 'zsh'),
  }
  const spawn = vi.fn((_input, nextObserver: TerminalPtyRuntimeEventObserver) => {
    observer = nextObserver
    if (options.dataDuringSpawn) nextObserver.onData(options.dataDuringSpawn, 'zsh')
    if (options.exitDuringSpawn) {
      nextObserver.onExit()
      dispose()
    }
    return { ok: true as const, runtime, events }
  })
  return {
    runtime,
    spawn,
    events,
    emitData(data) {
      if (dataEnabled) observer?.onData(data, 'zsh')
    },
    emitExit() {
      if (!exitEnabled) return
      observer?.onExit()
      dispose()
    },
    kill,
  }
}
