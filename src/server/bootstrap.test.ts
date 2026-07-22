import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const closeHttpServer = vi.fn()
  const serverOn = vi.fn()
  const runtimeShutdown = vi.fn()
  const disconnectAllInvalidationSockets = vi.fn()
  const websocketClose = vi.fn()
  const websocketConstructor = vi.fn()
  const websocketClients = new Set<{ close(): void }>()
  const createServerRuntime = vi.fn(() => ({
    app: { fetch: vi.fn() },
    appRealtimeHost: {},
    shutdown: runtimeShutdown,
  }))

  class MockWebSocketServer {
    clients = websocketClients
    close = websocketClose
    constructor(options: unknown) {
      websocketConstructor(options)
    }
  }

  return {
    closeHttpServer,
    serverOn,
    runtimeShutdown,
    disconnectAllInvalidationSockets,
    websocketClose,
    websocketConstructor,
    websocketClients,
    createServerRuntime,
    MockWebSocketServer,
  }
})

vi.mock('@hono/node-server', () => ({
  serve: vi.fn(() => ({
    on: mocks.serverOn,
    close: mocks.closeHttpServer,
  })),
}))

vi.mock('ws', () => ({
  WebSocketServer: mocks.MockWebSocketServer,
}))

vi.mock('#/server/runtime.ts', () => ({
  createServerRuntime: mocks.createServerRuntime,
}))

vi.mock('#/server/modules/invalidation-broker.ts', () => ({
  disconnectAllInvalidationSockets: mocks.disconnectAllInvalidationSockets,
}))

describe('bootstrap server shutdown', () => {
  beforeEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    mocks.websocketClients.clear()
  })

  test('gracefully shuts down realtime clients and forces lingering sockets closed without owning process exit', async () => {
    vi.useFakeTimers()
    const socket = { on: vi.fn(), once: vi.fn(), destroy: vi.fn() }
    const client = { close: vi.fn(), terminate: vi.fn() }
    mocks.websocketClients.add(client)
    mocks.serverOn.mockImplementation(
      (
        event: string,
        handler: (value: { once: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }) => void,
      ) => {
        if (event === 'connection') handler(socket)
      },
    )
    mocks.closeHttpServer.mockImplementation(() => {})
    mocks.websocketClose.mockImplementation(() => {})
    const exit = vi.fn()
    const { bootstrapServer } = await import('#/server/bootstrap.ts')

    // `bootstrapServer` is now async because it reads (or creates)
    // the access token from the data dir before serving. Await it
    // here; the rest of the test is unchanged.
    const server = await bootstrapServer({
      exit,
    })
    expect(mocks.websocketConstructor).toHaveBeenCalledWith({ noServer: true, maxPayload: 1024 * 1024 })
    const stopPromise = server.stop()

    await vi.advanceTimersByTimeAsync(1_000)
    await stopPromise

    expect(mocks.runtimeShutdown).toHaveBeenCalledTimes(1)
    expect(mocks.disconnectAllInvalidationSockets).toHaveBeenCalledTimes(1)
    expect(client.close).toHaveBeenCalledWith(1001, 'server shutting down')
    expect(client.terminate).toHaveBeenCalledTimes(1)
    expect(socket.destroy).toHaveBeenCalledTimes(1)
    expect(exit).not.toHaveBeenCalled()
  })

  test('isolates a client socket error without stopping the server', async () => {
    const socketListeners = new Map<string, (error?: Error) => void>()
    const socket = {
      on: vi.fn((event: string, handler: (error?: Error) => void) => {
        socketListeners.set(event, handler)
      }),
      once: vi.fn((event: string, handler: () => void) => {
        socketListeners.set(event, handler)
      }),
      destroy: vi.fn(),
    }
    mocks.serverOn.mockImplementation((event: string, handler: (value: typeof socket) => void) => {
      if (event === 'connection') handler(socket)
    })
    mocks.closeHttpServer.mockImplementation((callback: () => void) => callback())
    mocks.websocketClose.mockImplementation((callback: () => void) => callback())
    const { bootstrapServer } = await import('#/server/bootstrap.ts')
    const server = await bootstrapServer()

    const reset = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })
    expect(() => socketListeners.get('error')?.(reset)).not.toThrow()
    expect(socket.destroy).toHaveBeenCalledTimes(1)

    socketListeners.get('close')?.()
    await expect(server.stop()).resolves.toBeUndefined()
    expect(socket.destroy).toHaveBeenCalledTimes(1)
  })
})
