import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const closeHttpServer = vi.fn()
  const serverOn = vi.fn()
  const runtimeShutdown = vi.fn()
  const disconnectAllInvalidationSockets = vi.fn()
  const websocketClose = vi.fn()
  const websocketClients = new Set<any>()
  const createServerRuntime = vi.fn(() => ({
    app: { fetch: vi.fn() },
    terminalHost: {} as any,
    shutdown: runtimeShutdown,
  }))

  class MockWebSocketServer {
    clients = websocketClients
    close = websocketClose
    constructor(_options: unknown) {}
  }

  return {
    closeHttpServer,
    serverOn,
    runtimeShutdown,
    disconnectAllInvalidationSockets,
    websocketClose,
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
    const socket = { once: vi.fn(), destroy: vi.fn() }
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

    const server = bootstrapServer({
      exit,
    })
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
})
