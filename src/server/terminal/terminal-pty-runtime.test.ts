import { beforeEach, describe, expect, test, vi } from 'vitest'
import { spawnTerminalPtyRuntime } from '#/server/terminal/terminal-pty-runtime.ts'

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}))

vi.mock('node-pty', () => ({
  spawn: spawnMock,
}))

beforeEach(() => {
  spawnMock.mockReset()
})

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
})
