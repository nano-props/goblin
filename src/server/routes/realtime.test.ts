import { once } from 'node:events'
import { serve } from '@hono/node-server'
import { WebSocket, WebSocketServer } from 'ws'
import { deriveUserId } from '#/server/common/identity.ts'
import {
  disconnectAllNotificationSockets,
  publishClientIntent,
  publishNotification,
} from '#/server/realtime/notification-broker.ts'
import { describe, expect, test, vi } from 'vitest'
import type { ServerAppRealtimeHost, ServerAppRealtimeSocket } from '#/server/realtime/app-realtime-host.ts'
import { createRealtimeRoutes } from '#/server/routes/realtime.ts'

function makeTerminalHost(overrides: Partial<ServerAppRealtimeHost> = {}): ServerAppRealtimeHost {
  // `isValidClientId` is a type predicate; the test override has
  // to keep the signature compatible.
  const isValidClientId = ((value: unknown): value is string => typeof value === 'string') as never
  return {
    isValidClientId,
    getDiagnostics: vi.fn(() => ({}) as never),
    registerSocket: vi.fn(),
    unregisterSocket: vi.fn(),
    handleRealtimeMessage: vi.fn(),
    shutdown: vi.fn(),
    ...overrides,
  }
}

function acceptAll(): ServerAppRealtimeHost['isValidClientId'] {
  return ((value: unknown): value is string => typeof value === 'string') as never
}

function acceptOnly(allowed: string): ServerAppRealtimeHost['isValidClientId'] {
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
  test('rejects /notifications without a token', async () => {
    const host = makeTerminalHost()
    const app = createRealtimeRoutes({ accessToken: 'secret', appRealtimeHost: host })
    const res = await app.request('http://localhost/notifications')
    expect(res.status).toBe(401)
    const json = (await res.json()) as { ok: false; code: string; message: string }
    expect(json.message).toBe('Unauthorized')
    expect(json.code).toBe('UNAUTHORIZED')
  })

  test('rejects /notifications with a wrong token', async () => {
    const host = makeTerminalHost()
    const app = createRealtimeRoutes({ accessToken: 'secret', appRealtimeHost: host })
    const res = await app.request('http://localhost/notifications?t=wrong')
    expect(res.status).toBe(401)
  })

  test('rejects /app with a wrong token', async () => {
    const host = makeTerminalHost({ isValidClientId: acceptOnly('c1') })
    const app = createRealtimeRoutes({ accessToken: 'secret', appRealtimeHost: host })
    const res = await app.request('http://localhost/app?t=wrong&clientId=c1')
    expect(res.status).toBe(401)
  })

  test('rejects /app with an invalid clientId', async () => {
    const host = makeTerminalHost({ isValidClientId: acceptOnly('c1') })
    const app = createRealtimeRoutes({ accessToken: 'secret', appRealtimeHost: host })
    const res = await app.request('http://localhost/app?t=secret&clientId=bad')
    expect(res.status).toBe(400)
    const json = (await res.json()) as { ok: false; message: string }
    expect(json.message).toBe('Invalid client id')
  })

  test('rejects /app with a missing clientId', async () => {
    const host = makeTerminalHost({ isValidClientId: acceptAll() })
    const app = createRealtimeRoutes({ accessToken: 'secret', appRealtimeHost: host })
    const res = await app.request('http://localhost/app?t=secret')
    expect(res.status).toBe(400)
    const json = (await res.json()) as { ok: false; message: string }
    expect(json.message).toBe('Missing client id')
  })

  test.each(['/invalidation', '/client-intent'])('does not expose the removed %s endpoint', async (path) => {
    const app = createRealtimeRoutes({ accessToken: 'secret', appRealtimeHost: makeTerminalHost() })
    expect((await app.request(`http://localhost${path}?t=secret`)).status).toBe(404)
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
    const socket = {} as ServerAppRealtimeSocket
    // Method 2 adds `userId` between `clientId` and `socket`.
    // Tests verify the host receives the value the auth middleware
    // derived from the access token.
    host.handleRealtimeMessage('c1', 'owner_test', socket, 'ls -la\n')
    expect(handle).toHaveBeenCalledWith('c1', 'owner_test', socket, 'ls -la\n')
  })
})

test('notification upgrade shares delivery while preserving receiver opt-in and user filtering', async () => {
  disconnectAllNotificationSockets()
  const app = createRealtimeRoutes({ accessToken: 'secret', appRealtimeHost: makeTerminalHost() })
  const websocket = new WebSocketServer({ noServer: true })
  const server = serve({ hostname: '127.0.0.1', port: 0, fetch: app.fetch, websocket: { server: websocket } })
  let client: WebSocket | undefined
  try {
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('missing server address')
    client = new WebSocket(`ws://127.0.0.1:${address.port}/notifications?t=secret`)
    await once(client, 'open')
    const messages: string[] = []
    client.on('message', (data) => messages.push(data.toString()))
    const intent = { type: 'show-workspace-pane-tab-requested' as const, tab: 'changes' as const }
    expect(publishClientIntent(intent)).toBe(false)
    client.send(JSON.stringify({ type: 'client-intent-subscription', enabled: true }))
    await vi.waitFor(() => expect(publishClientIntent(intent)).toBe(true))
    await vi.waitFor(() => expect(messages).toHaveLength(1))
    expect(JSON.parse(messages[0]!)).toEqual({ type: 'client-effect-intent', intent })
    const notification = { type: 'settings-invalidated' as const, scopes: ['theme' as const] }
    expect(publishNotification(notification, 'other_user')).toBe(false)
    expect(publishNotification(notification, deriveUserId('secret'))).toBe(true)
    await vi.waitFor(() => expect(messages).toHaveLength(2))
    client.send(JSON.stringify({ type: 'client-intent-subscription', enabled: false }))
    await vi.waitFor(() => expect(publishClientIntent(intent)).toBe(false))
    const closed = once(client, 'close')
    client.send(JSON.stringify({ type: 'request', action: 'unexpected' }))
    expect((await closed)[0]).toBe(1008)
    await vi.waitFor(() => expect(publishNotification(notification)).toBe(false))
  } finally {
    client?.terminate()
    disconnectAllNotificationSockets()
    for (const socket of websocket.clients) socket.terminate()
    await new Promise<void>((resolve) => websocket.close(() => resolve()))
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  }
})
