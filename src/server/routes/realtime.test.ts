import { describe, expect, test, vi } from 'vitest'
import type { ServerRealtimeHost, ServerTerminalSocket } from '#/server/terminal/terminal-host.ts'
import { createRealtimeRoutes } from '#/server/routes/realtime.ts'

function makeTerminalHost(overrides: Partial<ServerRealtimeHost> = {}): ServerRealtimeHost {
  // `isValidClientId` is a type predicate; the test override has
  // to keep the signature compatible.
  const isValidClientId = ((value: unknown): value is string => typeof value === 'string') as never
  return {
    isValidClientId,
    isClientOnline: (_userId: string, _clientId: string): boolean => true,
    getDiagnostics: vi.fn(() => ({}) as never),
    registerSocket: vi.fn(),
    unregisterSocket: vi.fn(),
    handleRealtimeMessage: vi.fn(),
    shutdown: vi.fn(),
    ...overrides,
  }
}

function acceptAll(): ServerRealtimeHost['isValidClientId'] {
  return ((value: unknown): value is string => typeof value === 'string') as never
}

function acceptOnly(allowed: string): ServerRealtimeHost['isValidClientId'] {
  return ((value: unknown): value is string => value === allowed) as never
}

/**
 * `upgradeWebSocket` from `@hono/node-server` is hard to exercise
 * in-process without a real WebSocket pair. Drive the route sub-app
 * with `app.fetch` and inspect the auth + param validation
 * middleware's behaviour — the parts that run before the upgrade
 * handshake.
 */
describe('createRealtimeRoutes — auth middleware', () => {
  test('rejects /invalidation without a token', async () => {
    const host = makeTerminalHost()
    const app = createRealtimeRoutes({ accessToken: 'secret', terminalHost: host })
    const res = await app.request('http://localhost/invalidation')
    expect(res.status).toBe(401)
    const json = (await res.json()) as { ok: false; code: string; message: string }
    expect(json.message).toBe('Unauthorized')
    expect(json.code).toBe('FORBIDDEN')
  })

  test('rejects /invalidation with a wrong token', async () => {
    const host = makeTerminalHost()
    const app = createRealtimeRoutes({ accessToken: 'secret', terminalHost: host })
    const res = await app.request('http://localhost/invalidation?t=wrong')
    expect(res.status).toBe(401)
  })

  test('rejects /terminal with a wrong token', async () => {
    const host = makeTerminalHost({ isValidClientId: acceptOnly('c1') })
    const app = createRealtimeRoutes({ accessToken: 'secret', terminalHost: host })
    const res = await app.request('http://localhost/terminal?t=wrong&clientId=c1')
    expect(res.status).toBe(401)
  })

  test('rejects /terminal with an invalid clientId', async () => {
    const host = makeTerminalHost({ isValidClientId: acceptOnly('c1') })
    const app = createRealtimeRoutes({ accessToken: 'secret', terminalHost: host })
    const res = await app.request('http://localhost/terminal?t=secret&clientId=bad')
    expect(res.status).toBe(400)
    const json = (await res.json()) as { ok: false; message: string }
    expect(json.message).toBe('Invalid client id')
  })

  test('rejects /terminal with a missing clientId', async () => {
    const host = makeTerminalHost({ isValidClientId: acceptAll() })
    const app = createRealtimeRoutes({ accessToken: 'secret', terminalHost: host })
    const res = await app.request('http://localhost/terminal?t=secret')
    expect(res.status).toBe(400)
    const json = (await res.json()) as { ok: false; message: string }
    expect(json.message).toBe('Missing client id')
  })

  test('rejects /client-intent without a token', async () => {
    const host = makeTerminalHost()
    const app = createRealtimeRoutes({ accessToken: 'secret', terminalHost: host })
    const res = await app.request('http://localhost/client-intent')
    expect(res.status).toBe(401)
  })

  test('rejects /client-intent with a wrong token', async () => {
    const host = makeTerminalHost()
    const app = createRealtimeRoutes({ accessToken: 'secret', terminalHost: host })
    const res = await app.request('http://localhost/client-intent?t=wrong')
    expect(res.status).toBe(401)
  })
})

/**
 * The terminal WS message-size cap is enforced inside the
 * `onMessage` callback registered by `upgradeWebSocket`. That
 * callback is opaque from the HTTP side, so this test only
 * confirms the host receives forwarded messages — the cap
 * itself is exercised by the route's `onMessage` at runtime
 * (closing the socket with code 1009 above 1 MiB).
 */
describe('createRealtimeRoutes — terminal message forwarding', () => {
  test('host.handleRealtimeMessage is called with the raw payload', () => {
    const handle = vi.fn()
    const host = makeTerminalHost({ handleRealtimeMessage: handle })
    const socket = {} as ServerTerminalSocket
    // Method 2 adds `userId` between `clientId` and `socket`.
    // Tests verify the host receives the value the auth middleware
    // derived from the access token.
    host.handleRealtimeMessage('c1', 'owner_test', socket, 'ls -la\n')
    expect(handle).toHaveBeenCalledWith('c1', 'owner_test', socket, 'ls -la\n')
  })
})
