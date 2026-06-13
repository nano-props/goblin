import { describe, expect, test } from 'vitest'
import { Hono } from 'hono'
import { errorJson } from '#/server/common/responses.ts'

describe('errorJson', () => {
  test('maps IpcErrorCode to the same status as the createRouteApp IpcError handler', async () => {
    const app = new Hono()
    app.get('/bad', (c) => errorJson(c, 'BAD_REQUEST', 'nope'))
    app.get('/missing', (c) => errorJson(c, 'NOT_FOUND', 'gone'))
    app.get('/denied', (c) => errorJson(c, 'FORBIDDEN', 'no'))
    app.get('/boom', (c) => errorJson(c, 'INTERNAL_SERVER_ERROR', 'broken'))
    for (const [path, status] of [
      ['/bad', 400],
      ['/missing', 404],
      ['/denied', 401],
      ['/boom', 500],
    ] as const) {
      const res = await app.request(`http://localhost${path}`)
      expect(res.status).toBe(status)
      const json = (await res.json()) as { ok: false; code: string; message: string }
      expect(json).toMatchObject({ ok: false, code: expect.any(String), message: expect.any(String) })
    }
  })

  test('accepts an explicit status override', async () => {
    const app = new Hono()
    app.get('/x', (c) => errorJson(c, 'BAD_REQUEST', 'soon', 429))
    const res = await app.request('http://localhost/x')
    expect(res.status).toBe(429)
  })

  test('accepts transport-only codes (e.g. PAYLOAD_TOO_LARGE)', async () => {
    const app = new Hono()
    app.get('/x', (c) => errorJson(c, 'PAYLOAD_TOO_LARGE', 'too big'))
    const res = await app.request('http://localhost/x')
    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ ok: false, code: 'PAYLOAD_TOO_LARGE', message: 'too big' })
  })
})
