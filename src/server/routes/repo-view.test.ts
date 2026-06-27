import { beforeEach, describe, expect, test, vi } from 'vitest'
import { disconnectAllClientIntentSockets, registerClientIntentSocket } from '#/server/modules/client-intent-broker.ts'
import { createRepoViewRoutes } from '#/server/routes/repo-view.ts'
import { createApp } from '#/server/app-factory.ts'
import type { ServerTerminalHost } from '#/server/terminal/terminal-host.ts'

// Minimal terminal host stub for the auth-integration `createApp()`
// tests. Mirrors the one in `app-factory.test.ts`; a future refactor
// could extract it into a shared test helper if more test files need
// the same shape.
function makeTerminalHost(): ServerTerminalHost {
  return {
    isValidClientId: ((value: unknown): value is string => typeof value === 'string') as never,
    isClientConnected: ((_userId: string, _clientId: string): boolean => true) as never,
    getDiagnostics: vi.fn(() => ({}) as never),
    registerSocket: vi.fn(),
    unregisterSocket: vi.fn(),
    attach: vi.fn(async () => ({ ok: true }) as never),
    restart: vi.fn(async () => ({ ok: true }) as never),
    write: vi.fn(async () => ({ ok: true }) as never),
    resize: vi.fn(async () => ({ ok: true }) as never),
    takeover: vi.fn(async () => ({ ok: true }) as never),
    close: vi.fn(async () => ({ ok: true }) as never),
    listSessions: vi.fn(async () => []),
    create: vi.fn(async () => ({ ok: true }) as never),
    prune: vi.fn(async () => ({ pruned: 0, remaining: 0 })),
    getSessionSnapshot: vi.fn(async () => null),
    handleRealtimeMessage: vi.fn(),
    shutdown: vi.fn(),
  }
}

describe('POST /api/repo/view', () => {
  beforeEach(() => {
    disconnectAllClientIntentSockets()
  })

  test('returns 200 and fans out an intent when a client is subscribed', async () => {
    const subscriber = { send: vi.fn(), close: vi.fn() }
    registerClientIntentSocket(subscriber)

    const app = createRepoViewRoutes()
    const res = await app.request('http://localhost/view', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tab: 'changes' }),
    })

    expect(res.status).toBe(200)
    const json = (await res.json()) as { ok: true }
    expect(json).toEqual({ ok: true })
    expect(subscriber.send).toHaveBeenCalledWith(
      JSON.stringify({
        type: 'client-effect-intent',
        intent: { type: 'show-workspace-pane-view-requested', tab: 'changes' },
      }),
    )
  })

  test('returns 503 with a clear code when no client is subscribed', async () => {
    const app = createRepoViewRoutes()
    const res = await app.request('http://localhost/view', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tab: 'changes' }),
    })

    expect(res.status).toBe(503)
    const json = (await res.json()) as { ok: false; code: string; message: string }
    expect(json.ok).toBe(false)
    expect(json.code).toBe('NO_CLIENT')
    // Message must be the raw reason — the CLI prefixes it with `g:`,
    // so the contract forbids `g:` here. See `shared/repo-view.ts` for
    // the rationale.
    expect(json.message).toBe('no Goblin window is currently listening for intents')
  })

  test('rejects the terminal tab with 400 (terminal view is owned by the runtime)', async () => {
    const subscriber = { send: vi.fn(), close: vi.fn() }
    registerClientIntentSocket(subscriber)

    const app = createRepoViewRoutes()
    const res = await app.request('http://localhost/view', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tab: 'terminal' }),
    })

    expect(res.status).toBe(400)
    expect(subscriber.send).not.toHaveBeenCalled()
  })

  test('rejects unknown tab values with 400', async () => {
    const app = createRepoViewRoutes()
    const res = await app.request('http://localhost/view', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tab: 'banana' }),
    })
    expect(res.status).toBe(400)
  })

  test('rejects malformed JSON with 400', async () => {
    const app = createRepoViewRoutes()
    const res = await app.request('http://localhost/view', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    })
    expect(res.status).toBe(400)
  })

  test('rejects missing body with 400', async () => {
    const app = createRepoViewRoutes()
    const res = await app.request('http://localhost/view', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })
})

// The sub-app tests above exercise the route in isolation. These
// tests go through `createApp()` so the access-token middleware
// (mounted at `/api/repo/*` in `app-factory.ts`) is in the request
// path. Without this layer, a future change to the middleware
// registration (e.g. accidentally moving it under a more specific
// path) would silently leave `/api/repo/view` unauthenticated and
// no test would catch it.
describe('POST /api/repo/view — auth integration via createApp()', () => {
  test('rejects request without access token (401)', async () => {
    const app = createApp({
      version: '0.1.0',
      startedAt: 0,
      accessToken: 'secret',
      terminalHost: makeTerminalHost(),
    })
    const res = await app.request(
      new Request('http://127.0.0.1:32100/api/repo/view', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tab: 'changes' }),
      }),
    )
    expect(res.status).toBe(401)
    const json = (await res.json()) as { ok: false; code: string }
    expect(json.code).toBe('FORBIDDEN')
  })

  test('accepts request with access token and fans out the intent (200)', async () => {
    const subscriber = { send: vi.fn(), close: vi.fn() }
    registerClientIntentSocket(subscriber)

    const app = createApp({
      version: '0.1.0',
      startedAt: 0,
      accessToken: 'secret',
      terminalHost: makeTerminalHost(),
    })
    const res = await app.request(
      new Request('http://127.0.0.1:32100/api/repo/view', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goblin-access-token': 'secret',
        },
        body: JSON.stringify({ tab: 'changes' }),
      }),
    )
    expect(res.status).toBe(200)
    expect(subscriber.send).toHaveBeenCalledWith(
      JSON.stringify({
        type: 'client-effect-intent',
        intent: { type: 'show-workspace-pane-view-requested', tab: 'changes' },
      }),
    )
  })
})
