import { describe, expect, test } from 'vitest'
import { Hono } from 'hono'
import { errorJson, okJson, readJsonBody, throwIpcHttp } from '#/server/common/responses.ts'
import { IpcError } from '#/shared/api-types.ts'

describe('okJson', () => {
  test('wraps a successful payload in { ok: true, data } with default 200', async () => {
    const app = new Hono()
    app.get('/x', (c) => okJson(c, { hello: 'world' }))
    const res = await app.request('http://localhost/x')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, data: { hello: 'world' } })
  })

  test('honours a custom 2xx status', async () => {
    const app = new Hono()
    app.post('/x', (c) => okJson(c, { id: 1 }, 201))
    const res = await app.request('http://localhost/x', { method: 'POST' })
    expect(res.status).toBe(201)
  })
})

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
})

describe('readJsonBody', () => {
  test('parses a well-formed JSON object body', async () => {
    const app = new Hono()
    app.post('/x', async (c) => {
      const r = await readJsonBody(c)
      if (!r.ok) return r.response
      return c.json({ received: r.body })
    })
    const res = await app.request('http://localhost/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ a: 1 }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ received: { a: 1 } })
  })

  test('treats an empty body as undefined so parseHttpInput can decide', async () => {
    const app = new Hono()
    app.post('/x', async (c) => {
      const r = await readJsonBody(c)
      if (!r.ok) return r.response
      return c.json({ received: r.body })
    })
    const res = await app.request('http://localhost/x', { method: 'POST' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ received: undefined })
  })

  test('returns 400 with a clear message on malformed JSON', async () => {
    const app = new Hono()
    app.post('/x', async (c) => {
      const r = await readJsonBody(c)
      if (!r.ok) return r.response
      return c.json({ received: r.body })
    })
    const res = await app.request('http://localhost/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ this is not json',
    })
    expect(res.status).toBe(400)
    const json = (await res.json()) as { ok: false; code: string; message: string }
    expect(json).toEqual({ ok: false, code: 'BAD_REQUEST', message: 'Request body is not valid JSON' })
  })
})

describe('throwIpcHttp', () => {
  test('throws an IpcError that createRouteApp converts to the right status', async () => {
    const app = new Hono()
    app.onError((err, c) => {
      if (err instanceof IpcError) {
        return c.json({ ok: false, code: err.code, message: err.message }, 404)
      }
      throw err
    })
    app.get('/x', () => throwIpcHttp('NOT_FOUND', 'repo not found'))
    const res = await app.request('http://localhost/x')
    expect(res.status).toBe(404)
  })
})
