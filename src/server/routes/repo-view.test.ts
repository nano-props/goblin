import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  disconnectAllRendererIntentSockets,
  registerRendererIntentSocket,
} from '#/server/modules/renderer-intent-broker.ts'
import { createRepoViewRoutes } from '#/server/routes/repo-view.ts'

describe('POST /api/repo/view', () => {
  beforeEach(() => {
    disconnectAllRendererIntentSockets()
  })

  test('returns 200 and fans out an intent when a renderer is subscribed', async () => {
    const subscriber = { send: vi.fn(), close: vi.fn() }
    registerRendererIntentSocket(subscriber)

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
        type: 'renderer-effect-intent',
        intent: { type: 'show-workspace-pane-view-requested', tab: 'changes' },
      }),
    )
  })

  test('returns 503 with a clear code when no renderer is subscribed', async () => {
    const app = createRepoViewRoutes()
    const res = await app.request('http://localhost/view', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tab: 'changes' }),
    })

    expect(res.status).toBe(503)
    const json = (await res.json()) as { ok: false; code: string; message: string }
    expect(json.ok).toBe(false)
    expect(json.code).toBe('NO_RENDERER')
    // Message must be the raw reason — the CLI prefixes it with `g:`,
    // so the contract forbids `g:` here. See `shared/repo-view.ts` for
    // the rationale.
    expect(json.message).toBe('no Goblin window is currently listening for intents')
  })

  test('rejects the terminal tab with 400 (terminal view is owned by the runtime)', async () => {
    const subscriber = { send: vi.fn(), close: vi.fn() }
    registerRendererIntentSocket(subscriber)

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
