import { userInfo } from 'node:os'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Mock } from 'vitest'
import { resolveLocalShell } from '#/server/terminal/terminal-local-shell.ts'
import { spawnTerminalPtyRuntime } from '#/server/terminal/terminal-pty-runtime.ts'
import type { SpawnTerminalPtyRuntimeInput } from '#/server/terminal/terminal-pty-runtime.ts'
import { advanceTimersAndFlush, useFakeTimers } from '#/test-utils/timers.ts'
import type * as NodeOsModule from 'node:os'

vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof NodeOsModule>()),
  userInfo: vi.fn(),
}))
vi.mock('#/system/terminal-process-name.ts', () => ({ readTerminalProcessName: () => 'zsh' }))
const spawn = vi.fn()
const input: SpawnTerminalPtyRuntimeInput = { command: '/bin/zsh', cwd: '/repo', cols: 80, rows: 24 }
const observer = { onData: vi.fn(), onExit: vi.fn() }
let callbacks: { data(terminal: unknown, bytes: Uint8Array): void; exit(): void }
let resolveExit: (code: number) => void
let terminal: {
  closed: boolean
  write: Mock<(data: string) => number>
  resize: Mock<(cols: number, rows: number) => void>
  close: Mock<() => void>
}
const kill = vi.fn<() => void>()

beforeEach(() => {
  vi.stubGlobal('Bun', { spawn })
  terminal = { closed: false, write: vi.fn(), resize: vi.fn(), close: vi.fn() }
  terminal.close.mockImplementation(() => {
    terminal.closed = true
    callbacks.exit()
  })
  kill.mockReset()
  spawn.mockImplementation((_command, options) => {
    callbacks = options.terminal
    return {
      pid: 123,
      terminal,
      kill,
      exited: new Promise<number>((resolve) => {
        resolveExit = resolve
      }),
    }
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('Bun PTY adapter', () => {
  beforeEach(() => useFakeTimers())
  test('passes shell arguments, geometry and environment to Bun', () => {
    const result = spawnTerminalPtyRuntime({ ...input, args: ['-l'], env: { TERM: 'bad', EXAMPLE: 'value' } }, observer)
    expect(result.ok).toBe(true)
    expect(spawn).toHaveBeenCalledWith(
      ['/bin/zsh', '-l'],
      expect.objectContaining({
        cwd: '/repo',
        env: expect.objectContaining({ TERM: 'xterm-256color', EXAMPLE: 'value' }),
        terminal: expect.objectContaining({ cols: 80, rows: 24 }),
      }),
    )
  })
  test('decodes UTF-8 across chunks and delivers trailing output before exit', async () => {
    const result = spawnTerminalPtyRuntime(input, observer)
    expect(result.ok).toBe(true)
    const bytes = new TextEncoder().encode('中文')
    callbacks.data(terminal, bytes.subarray(0, 2))
    expect(observer.onData).not.toHaveBeenCalled()
    resolveExit(0)
    await Promise.resolve()
    expect(observer.onExit).not.toHaveBeenCalled()
    callbacks.data(terminal, bytes.subarray(2))
    expect(observer.onData).toHaveBeenCalledWith('中文', 'zsh')
    callbacks.exit()
    expect(terminal.close).toHaveBeenCalledOnce()
    expect(observer.onExit).toHaveBeenCalledOnce()
    callbacks.exit()
    expect(observer.onExit).toHaveBeenCalledOnce()
  })
  test('bounds output draining after shell exit even when the slave remains open', async () => {
    const result = spawnTerminalPtyRuntime(input, observer)
    if (!result.ok) throw new Error(result.message)
    resolveExit(0)
    await advanceTimersAndFlush(199)
    expect(observer.onExit).not.toHaveBeenCalled()
    callbacks.data(terminal, new TextEncoder().encode('tail'))
    // Flush an incomplete final code point exactly once when retiring output.
    callbacks.data(terminal, new Uint8Array([0xe4]))
    await advanceTimersAndFlush(1)
    expect(observer.onData.mock.calls.map(([data]) => data)).toEqual(['tail', '\ufffd'])
    expect(terminal.close).toHaveBeenCalledOnce()
    expect(observer.onExit).toHaveBeenCalledOnce()
    expect(() => result.runtime.write('late')).toThrow('Terminal has exited')
    callbacks.data(terminal, new TextEncoder().encode('late'))
    callbacks.exit()
    expect(observer.onData).toHaveBeenCalledTimes(2)
    expect(observer.onExit).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
  test('EOF cancels the drain deadline and publishes exit only once', async () => {
    spawnTerminalPtyRuntime(input, observer)
    resolveExit(0)
    await advanceTimersAndFlush(50)
    callbacks.exit()
    expect(vi.getTimerCount()).toBe(0)
    await advanceTimersAndFlush(200)
    expect(terminal.close).toHaveBeenCalledOnce()
    expect(observer.onExit).toHaveBeenCalledOnce()
  })
  test('manual close completes draining immediately after shell exit', async () => {
    const result = spawnTerminalPtyRuntime(input, observer)
    if (!result.ok) throw new Error(result.message)
    resolveExit(0)
    await advanceTimersAndFlush(50)
    result.runtime.kill()
    expect(observer.onExit).toHaveBeenCalledOnce()
    expect(terminal.close).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
  test('also waits for process exit when EOF arrives first', async () => {
    spawnTerminalPtyRuntime(input, observer)
    callbacks.exit()
    expect(observer.onExit).not.toHaveBeenCalled()
    resolveExit(0)
    await Promise.resolve()
    expect(observer.onExit).toHaveBeenCalledOnce()
  })
  test('writes each input once and resizes the terminal', () => {
    const result = spawnTerminalPtyRuntime(input, observer)
    if (!result.ok) throw new Error(result.message)
    terminal.write.mockReturnValue(1)
    result.runtime.write('abc')
    result.runtime.resize(100, 40)
    expect(terminal.write).toHaveBeenCalledExactlyOnceWith('abc')
    expect(terminal.resize).toHaveBeenCalledWith(100, 40)
    callbacks.exit()
    expect(() => result.runtime.write('late')).toThrow('Terminal has exited')
  })
  test('data disposal retains the exit observer needed by kill-and-wait', async () => {
    const result = spawnTerminalPtyRuntime(input, observer)
    if (!result.ok) throw new Error(result.message)
    result.events.disposeData()
    callbacks.data(terminal, new TextEncoder().encode('ignored'))
    result.runtime.kill()
    expect(kill).toHaveBeenCalledWith('SIGHUP')
    expect(terminal.close).toHaveBeenCalledOnce()
    callbacks.exit()
    resolveExit(0)
    await Promise.resolve()
    expect(observer.onData).not.toHaveBeenCalled()
    expect(observer.onExit).toHaveBeenCalledOnce()
  })
  test('full disposal releases both observers', async () => {
    const result = spawnTerminalPtyRuntime(input, observer)
    if (!result.ok) throw new Error(result.message)
    result.events.dispose()
    callbacks.data(terminal, new TextEncoder().encode('ignored'))
    callbacks.exit()
    resolveExit(0)
    await Promise.resolve()
    expect(observer.onData).not.toHaveBeenCalled()
    expect(observer.onExit).not.toHaveBeenCalled()
  })
  test('reports spawn failure without publishing a runtime', () => {
    spawn.mockImplementationOnce(() => {
      throw new Error('missing shell')
    })
    expect(spawnTerminalPtyRuntime(input, observer)).toEqual({ ok: false, message: 'missing shell' })
  })
  test('rejects ambiguous shell startup configuration before spawning', () => {
    expect(spawnTerminalPtyRuntime({ ...input, startupShellCommand: 'echo ready' }, observer)).toEqual({
      ok: false,
      message: 'startupShellCommand cannot be combined with command or args',
    })
    expect(spawn).not.toHaveBeenCalled()
  })
})
describe('local shell fallback', () => {
  test('falls back to os.userInfo().shell when SHELL is not set (CI / devcontainer)', () => {
    vi.mocked(userInfo).mockReturnValue({ shell: '/usr/bin/zsh' } as ReturnType<typeof userInfo>)

    const resolved = resolveLocalShell({}, { PATH: '/usr/bin' })

    expect(resolved).toEqual({ command: '/usr/bin/zsh', args: ['-l'] })
    expect(userInfo).toHaveBeenCalledTimes(1)
  })

  test('treats whitespace-only SHELL as unset and falls through to userInfo', () => {
    vi.mocked(userInfo).mockReturnValue({ shell: '/usr/bin/zsh' } as ReturnType<typeof userInfo>)

    const resolved = resolveLocalShell({}, { SHELL: '   ' })

    expect(resolved).toEqual({ command: '/usr/bin/zsh', args: ['-l'] })
  })

  test('treats whitespace-only userInfo().shell as unset and falls back to /bin/sh', () => {
    vi.mocked(userInfo).mockReturnValue({ shell: '   ' } as ReturnType<typeof userInfo>)

    const resolved = resolveLocalShell({}, {})

    expect(resolved).toEqual({ command: '/bin/sh', args: ['-l'] })
  })

  test('falls back to /bin/sh when neither env.SHELL nor userInfo().shell is available', () => {
    vi.mocked(userInfo).mockImplementation(() => {
      throw new Error('userInfo unavailable')
    })

    const resolved = resolveLocalShell({}, {})

    expect(resolved).toEqual({ command: '/bin/sh', args: ['-l'] })
  })
})
