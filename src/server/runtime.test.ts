import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ServerTerminalHost } from '#/server/terminal/terminal-host.ts'

const mocks = vi.hoisted(() => ({
  createApp: vi.fn(() => ({ fetch: vi.fn() })),
  stopBackgroundSync: vi.fn(),
  workerHostCtor: vi.fn(),
}))

vi.mock('#/server/app-factory.ts', () => ({
  createApp: mocks.createApp,
}))

vi.mock('#/server/modules/background-sync.ts', () => ({
  stopBackgroundSync: mocks.stopBackgroundSync,
}))

vi.mock('#/server/terminal/terminal-worker-host.ts', () => ({
  WorkerBackedTerminalHost: class {
    constructor(options?: unknown) {
      const host = {
        isValidClientId: (_value: unknown): _value is string => true,
        getDiagnostics: vi.fn(),
        registerSocket: vi.fn(),
        unregisterSocket: vi.fn(),
        attach: vi.fn(),
        restart: vi.fn(),
        write: vi.fn(),
        resize: vi.fn(),
        takeover: vi.fn(),
        close: vi.fn(),
        notifyBell: vi.fn(),
        listSessions: vi.fn(),
        create: vi.fn(),
        prune: vi.fn(),
        getSessionSnapshot: vi.fn(),
        shutdown: vi.fn(),
      }
      mocks.workerHostCtor({ host, options })
      return host
    }
  },
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
      internalSecret: 'secret',
      serverHost: '127.0.0.1',
      serverPort: 32100,
      terminalHost,
    })

    expect(runtime.terminalHost).toBe(terminalHost)
    expect(mocks.createApp).toHaveBeenCalledWith({
      version: '0.1.0',
      startedAt: 1,
      internalSecret: 'secret',
      serverHost: '127.0.0.1',
      serverPort: 32100,
      terminalHost,
    })
  })

  test('uses the worker-backed terminal host by default', async () => {
    const { createServerRuntime } = await import('#/server/runtime.ts')

    const runtime = createServerRuntime({
      version: '0.1.0',
      startedAt: 1,
      internalSecret: 'secret',
      serverHost: '127.0.0.1',
      serverPort: 32100,
      terminalWorkerEntry: '/tmp/entrypoints/terminal-worker.ts',
    })

    expect(mocks.workerHostCtor).toHaveBeenCalledTimes(1)
    expect(runtime.terminalHost).toBe(mocks.workerHostCtor.mock.calls[0]?.[0]?.host)
    expect(mocks.workerHostCtor).toHaveBeenCalledWith({
      host: runtime.terminalHost,
      options: { workerEntry: '/tmp/entrypoints/terminal-worker.ts' },
    })
    expect(mocks.createApp).toHaveBeenCalledWith({
      version: '0.1.0',
      startedAt: 1,
      internalSecret: 'secret',
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
      internalSecret: 'secret',
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
