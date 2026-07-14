import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ServerAppRealtimeHost } from '#/server/realtime/app-realtime-host.ts'
import type { ServerWorkspacePaneTabsHost } from '#/server/workspace-pane/workspace-pane-tabs-host.ts'

const mocks = vi.hoisted(() => ({
  createApp: vi.fn(() => ({ fetch: vi.fn() })),
  stopBackgroundSync: vi.fn(),
  createInProcessPtySupervisor: vi.fn(() => ({ mode: 'in-process' })),
  createServerTerminalRuntime: vi.fn(() => ({
    host: {
      isValidClientId: (_value: unknown): _value is string => true,
      shutdown: vi.fn(),
    } as unknown as ServerAppRealtimeHost,
    workspacePaneTabsHost: {
      listWorkspaceTabs: vi.fn(),
      replaceTabs: vi.fn(),
      updateTabs: vi.fn(),
    },
    worktreeRemovalApplication: { removeWorktree: vi.fn() },
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

function makeWorkspacePaneTabsHost(): ServerWorkspacePaneTabsHost {
  return {
    initializeTabs: vi.fn(async () => ({ revision: 0, entries: [] })),
    listWorkspaceTabs: vi.fn(),
    replaceTabs: vi.fn(),
    updateTabs: vi.fn(),
  }
}

describe('server runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('injects the app realtime host into the server app factory', async () => {
    const { createServerRuntime } = await import('#/server/runtime.ts')
    const appRealtimeHost = { shutdown: vi.fn() } as unknown as ServerAppRealtimeHost
    const workspacePaneTabsHost = makeWorkspacePaneTabsHost()
    const worktreeRemovalApplication = { removeWorktree: vi.fn() }

    const runtime = createServerRuntime({
      version: '0.1.0',
      startedAt: 1,
      accessToken: 'secret',
      serverHost: '127.0.0.1',
      serverPort: 32100,
      appRealtimeHost,
      workspacePaneTabsHost,
      worktreeRemovalApplication,
    })

    expect(runtime.appRealtimeHost).toBe(appRealtimeHost)
    expect(mocks.createApp).toHaveBeenCalledWith({
      version: '0.1.0',
      startedAt: 1,
      accessToken: 'secret',
      serverHost: '127.0.0.1',
      serverPort: 32100,
      appRealtimeHost,
      workspacePaneTabsHost,
      worktreeRemovalApplication,
    })
  })

  test('rejects partial host injection instead of mixing injected and managed hosts', async () => {
    const { createServerRuntime } = await import('#/server/runtime.ts')
    const appRealtimeHost = { shutdown: vi.fn() } as unknown as ServerAppRealtimeHost

    expect(() =>
      createServerRuntime({
        version: '0.1.0',
        startedAt: 1,
        accessToken: 'secret',
        serverHost: '127.0.0.1',
        serverPort: 32100,
        appRealtimeHost,
      } as never),
    ).toThrow('server runtime host injection must include all hosts')
    expect(mocks.createServerTerminalRuntime).not.toHaveBeenCalled()
    expect(mocks.createApp).not.toHaveBeenCalled()
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
      gCommand: undefined,
    })
    expect(runtime.appRealtimeHost).toBe(mocks.createServerTerminalRuntime.mock.results[0]?.value.host)
    expect(mocks.createApp).toHaveBeenCalledWith({
      version: '0.1.0',
      startedAt: 1,
      accessToken: 'secret',
      serverHost: '127.0.0.1',
      serverPort: 32100,
      appRealtimeHost: runtime.appRealtimeHost,
      workspacePaneTabsHost: mocks.createServerTerminalRuntime.mock.results[0]?.value.workspacePaneTabsHost,
      worktreeRemovalApplication: mocks.createServerTerminalRuntime.mock.results[0]?.value.worktreeRemovalApplication,
    })
  })

  test('shutdown is idempotent and stops background sync before app realtime host teardown', async () => {
    const { createServerRuntime } = await import('#/server/runtime.ts')
    const events: string[] = []
    const appRealtimeHost = {
      shutdown: vi.fn(() => {
        events.push('terminal')
      }),
    } as unknown as ServerAppRealtimeHost
    const workspacePaneTabsHost = makeWorkspacePaneTabsHost()
    const worktreeRemovalApplication = { removeWorktree: vi.fn() }
    mocks.stopBackgroundSync.mockImplementation(() => {
      events.push('background-sync')
    })

    const runtime = createServerRuntime({
      version: '0.1.0',
      startedAt: 1,
      accessToken: 'secret',
      serverHost: '127.0.0.1',
      serverPort: 32100,
      appRealtimeHost,
      workspacePaneTabsHost,
      worktreeRemovalApplication,
    })

    runtime.shutdown()
    runtime.shutdown()

    expect(mocks.stopBackgroundSync).toHaveBeenCalledTimes(1)
    expect(appRealtimeHost.shutdown).toHaveBeenCalledTimes(1)
    expect(events).toEqual(['background-sync', 'terminal'])
  })

  test('wires the g command runtime when an entrypoint is available', async () => {
    const { createServerRuntime } = await import('#/server/runtime.ts')

    createServerRuntime({
      version: '0.1.0',
      startedAt: 1,
      accessToken: 'secret',
      serverHost: '0.0.0.0',
      serverPort: 32100,
      gCommandEntry: '/app/dist/server/g-command.js',
      gCommandBinDir: '/app/terminal-bin',
      gCommandNodePath: '/app/electron',
    })

    expect(mocks.createServerTerminalRuntime).toHaveBeenCalledWith({
      ptySupervisor: expect.objectContaining({ mode: 'in-process' }),
      gCommand: {
        serverUrl: 'http://127.0.0.1:32100',
        accessToken: 'secret',
        entryPath: '/app/dist/server/g-command.js',
        binDir: '/app/terminal-bin',
        nodePath: '/app/electron',
      },
    })
  })
})
