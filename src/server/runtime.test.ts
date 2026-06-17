import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ServerTerminalHost } from '#/server/terminal/terminal-host.ts'

const mocks = vi.hoisted(() => ({
  createApp: vi.fn(() => ({ fetch: vi.fn() })),
  stopBackgroundSync: vi.fn(),
  createInProcessPtySupervisor: vi.fn(() => ({ mode: 'in-process' })),
  createServerTerminalRuntime: vi.fn(() => ({
    host: {
      isValidClientId: (_value: unknown): _value is string => true,
      shutdown: vi.fn(),
    } as unknown as ServerTerminalHost,
    shutdown: vi.fn(),
  })),
}))

vi.mock('#/server/app-factory.ts', () => ({
  createApp: mocks.createApp,
}))

vi.mock('#/server/modules/background-sync.ts', () => ({
  stopBackgroundSync: mocks.stopBackgroundSync,
}))

vi.mock('#/server/terminal/pty-supervisor-inprocess.ts', () => ({
  createInProcessPtySupervisor: mocks.createInProcessPtySupervisor,
}))

vi.mock('#/server/terminal/terminal-runtime.ts', () => ({
  createServerTerminalRuntime: mocks.createServerTerminalRuntime,
}))

describe('server runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('injects the terminal host into the server app factory', async () => {
    const { createServerRuntime } = await import('#/server/runtime.ts')
    const terminalHost = { shutdown: vi.fn() } as unknown as ServerTerminalHost

    const runtime = createServerRuntime({
      version: '0.1.0',
      startedAt: 1,
      accessToken: 'secret',
      serverHost: '127.0.0.1',
      serverPort: 32100,
      terminalHost,
    })

    expect(runtime.terminalHost).toBe(terminalHost)
    expect(mocks.createApp).toHaveBeenCalledWith({
      version: '0.1.0',
      startedAt: 1,
      accessToken: 'secret',
      serverHost: '127.0.0.1',
      serverPort: 32100,
      terminalHost,
    })
  })

  test('wires the in-process pty supervisor into the terminal runtime by default', async () => {
    const { createServerRuntime } = await import('#/server/runtime.ts')

    const runtime = createServerRuntime({
      version: '0.1.0',
      startedAt: 1,
      accessToken: 'secret',
      serverHost: '127.0.0.1',
      serverPort: 32100,
    })

    expect(mocks.createInProcessPtySupervisor).toHaveBeenCalledTimes(1)
    expect(mocks.createServerTerminalRuntime).toHaveBeenCalledTimes(1)
    expect(mocks.createServerTerminalRuntime).toHaveBeenCalledWith({
      ptySupervisor: expect.objectContaining({ mode: 'in-process' }),
    })
    expect(runtime.terminalHost).toBe(mocks.createServerTerminalRuntime.mock.results[0]?.value.host)
    expect(mocks.createApp).toHaveBeenCalledWith({
      version: '0.1.0',
      startedAt: 1,
      accessToken: 'secret',
      serverHost: '127.0.0.1',
      serverPort: 32100,
      terminalHost: runtime.terminalHost,
    })
  })

  test('shutdown is idempotent and stops background sync before terminal host teardown', async () => {
    const { createServerRuntime } = await import('#/server/runtime.ts')
    const events: string[] = []
    const terminalHost = {
      shutdown: vi.fn(() => {
        events.push('terminal')
      }),
    } as unknown as ServerTerminalHost
    mocks.stopBackgroundSync.mockImplementation(() => {
      events.push('background-sync')
    })

    const runtime = createServerRuntime({
      version: '0.1.0',
      startedAt: 1,
      accessToken: 'secret',
      serverHost: '127.0.0.1',
      serverPort: 32100,
      terminalHost,
    })

    runtime.shutdown()
    runtime.shutdown()

    expect(mocks.stopBackgroundSync).toHaveBeenCalledTimes(1)
    expect(terminalHost.shutdown).toHaveBeenCalledTimes(1)
    expect(events).toEqual(['background-sync', 'terminal'])
  })
})
