import { userInfo } from 'node:os'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { resolveLocalShell } from '#/server/terminal/terminal-local-shell.ts'
import { spawnTerminalPtyRuntime } from '#/server/terminal/terminal-pty-runtime.ts'

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}))

vi.mock('node-pty', () => ({
  spawn: spawnMock,
}))

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return {
    ...actual,
    userInfo: vi.fn(),
  }
})

const originalShell = process.env.SHELL

beforeEach(() => {
  spawnMock.mockReset()
  vi.mocked(userInfo).mockReset()
  // Force a stable test env. Without this, a CI runner with SHELL=
  // (or unset) would skip the inherited-SHELL branch and the test
  // would race against the host environment.
  process.env.SHELL = '/bin/zsh'
})

afterEach(() => {
  process.env.SHELL = originalShell
})

function ptyStub(processName = 'zsh') {
  return {
    process: processName,
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: vi.fn(() => ({ dispose: vi.fn() })),
    onExit: vi.fn(() => ({ dispose: vi.fn() })),
  }
}

describe('spawnTerminalPtyRuntime', () => {
  test('returns a trimmed process name when node-pty exposes a string', () => {
    spawnMock.mockReturnValue({
      process: ' zsh ',
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      onData: vi.fn(() => ({ dispose: vi.fn() })),
      onExit: vi.fn(() => ({ dispose: vi.fn() })),
    })

    const result = spawnTerminalPtyRuntime({
      cwd: '/repo',
      cols: 80,
      rows: 24,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.runtime.processName()).toBe('zsh')
  })

  test('falls back to terminal when the process getter throws', () => {
    spawnMock.mockReturnValue({
      get process() {
        throw new Error('process unavailable')
      },
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      onData: vi.fn(() => ({ dispose: vi.fn() })),
      onExit: vi.fn(() => ({ dispose: vi.fn() })),
    })

    const result = spawnTerminalPtyRuntime({
      cwd: '/repo',
      cols: 80,
      rows: 24,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.runtime.processName()).toBe('terminal')
  })

  test('reads the process getter only once per lookup', () => {
    let reads = 0
    spawnMock.mockReturnValue({
      get process() {
        reads += 1
        return reads === 1 ? 'zsh' : undefined
      },
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      onData: vi.fn(() => ({ dispose: vi.fn() })),
      onExit: vi.fn(() => ({ dispose: vi.fn() })),
    })

    const result = spawnTerminalPtyRuntime({
      cwd: '/repo',
      cols: 80,
      rows: 24,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.runtime.processName()).toBe('zsh')
    expect(reads).toBe(1)
  })

  test('honours an explicit command override without consulting env or passwd', () => {
    vi.mocked(userInfo).mockReturnValue({ shell: '/bin/zsh' } as ReturnType<typeof userInfo>)
    spawnMock.mockReturnValue(ptyStub())

    spawnTerminalPtyRuntime({
      command: '/usr/local/bin/fish',
      args: ['--login'],
      cwd: '/repo',
      cols: 80,
      rows: 24,
    })

    expect(spawnMock).toHaveBeenCalledWith(
      '/usr/local/bin/fish',
      ['--login'],
      expect.objectContaining({ cwd: '/repo' }),
    )
    // Explicit override must short-circuit both env and userInfo lookups —
    // otherwise a future regression that always polls userInfo would slow
    // every explicit-override spawn by an os syscall.
    expect(userInfo).not.toHaveBeenCalled()
  })

  test('uses the inherited SHELL on Unix when it is set, with -l for login mode', () => {
    vi.mocked(userInfo).mockReturnValue({ shell: '/bin/zsh' } as ReturnType<typeof userInfo>)
    spawnMock.mockReturnValue(ptyStub())

    spawnTerminalPtyRuntime({
      cwd: '/repo',
      cols: 80,
      rows: 24,
    })

    expect(spawnMock).toHaveBeenCalledWith('/bin/zsh', ['-l'], expect.objectContaining({ cwd: '/repo' }))
    // Explicit env.SHELL must win — passwd fallback is only consulted when
    // the inherited env is silent (CI / devcontainer scenarios).
    expect(userInfo).not.toHaveBeenCalled()
  })

  test('merges caller env into the spawned PTY environment while keeping terminal TERM', () => {
    spawnMock.mockReturnValue(ptyStub())

    spawnTerminalPtyRuntime({
      cwd: '/repo',
      cols: 80,
      rows: 24,
      env: {
        PATH: '/g/bin:/usr/bin',
        GOBLIN_TERMINAL: '1',
        TERM: 'bad-term',
      },
    })

    expect(spawnMock).toHaveBeenCalledWith(
      '/bin/zsh',
      ['-l'],
      expect.objectContaining({
        env: expect.objectContaining({
          PATH: '/g/bin:/usr/bin',
          GOBLIN_TERMINAL: '1',
          TERM: 'xterm-256color',
        }),
      }),
    )
  })

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
