import { describe, expect, test } from 'vitest'
import { Hono } from 'hono'
import { applyApiSecurityHeaders, buildCorsOriginPredicate } from '#/server/common/http-harden.ts'

describe('applyApiSecurityHeaders', () => {
  test('sets Cache-Control and X-Content-Type-Options on every /api response', async () => {
    const app = new Hono()
    app.use('/api/*', applyApiSecurityHeaders())
    app.get('/api/ping', (c) => c.json({ ok: true }))

    const response = await app.request('http://localhost/api/ping')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    // `Vary: Origin` is set by Hono's `cors()` middleware, not here.
    // Verified separately in the cors integration in app-factory.test.ts.
  })

  test('does not override a handler-supplied Cache-Control header', async () => {
    const app = new Hono()
    app.use('/api/*', applyApiSecurityHeaders())
    app.get('/api/ping', (c) => {
      c.header('Cache-Control', 'public, max-age=60')
      return c.json({ ok: true })
    })

    const response = await app.request('http://localhost/api/ping')
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=60')
  })

  test('applies headers on error responses too', async () => {
    const app = new Hono()
    // Suppress Hono's default `console.error(error)` for the deliberate
    // throw below — the test is about header application, not error
    // logging, and the default handler would surface as stderr noise
    // under verbose reporters. Production wires a real `onError` in
    // `http-validate.ts:createRouteApp`; this minimal stub matches the
    // shape production uses (IpcError-aware handler is unnecessary
    // here because the test only throws plain Errors).
    app.onError((_err, c) => c.text('Internal Server Error', 500))
    app.use('/api/*', applyApiSecurityHeaders())
    app.get('/api/fail', () => {
      throw new Error('boom')
    })

    const response = await app.request('http://localhost/api/fail')
    expect(response.status).toBe(500)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })
})

describe('buildCorsOriginPredicate', () => {
  const predicate = buildCorsOriginPredicate('127.0.0.1', 32100)

  test('allows loopback on the same port', () => {
    expect(predicate('http://localhost:32100')).toBe(true)
    expect(predicate('http://127.0.0.1:32100')).toBe(true)
    expect(predicate('http://[::1]:32100')).toBe(true)
  })

  test('allows the configured bind host on the same port', () => {
    expect(predicate('http://127.0.0.1:32100')).toBe(true)
  })

  test('rejects a different port', () => {
    expect(predicate('http://localhost:8080')).toBe(false)
  })

  test('rejects a different host', () => {
    expect(predicate('http://attacker.example:32100')).toBe(false)
  })

  test('rejects a malformed origin', () => {
    expect(predicate('not-a-url')).toBe(false)
  })

  test('allows an absent origin (Electron IPC, same-origin fetches)', () => {
    expect(predicate(undefined)).toBe(true)
  })
})

describe('buildCorsOriginPredicate with a specific LAN bind host', () => {
  const predicate = buildCorsOriginPredicate('192.168.1.5', 32100)

  test('allows the bind host on the same port', () => {
    expect(predicate('http://192.168.1.5:32100')).toBe(true)
  })

  test('still allows loopback on the same port', () => {
    expect(predicate('http://localhost:32100')).toBe(true)
  })

  test('rejects other LAN hosts on the same port', () => {
    // A specific bind address is the only LAN allow entry — the
    // operator is responsible for choosing a specific bind address
    // when they want to expose the server on a particular network.
    expect(predicate('http://192.168.1.6:32100')).toBe(false)
  })
})

describe('buildCorsOriginPredicate with a wildcard bind host', () => {
  const predicate = buildCorsOriginPredicate('0.0.0.0', 32100)

  test('allows loopback on the same port', () => {
    expect(predicate('http://localhost:32100')).toBe(true)
    expect(predicate('http://127.0.0.1:32100')).toBe(true)
  })

  test('allows any LAN host on the same port — wildcard bind is explicit cross-network access', () => {
    expect(predicate('http://192.168.1.5:32100')).toBe(true)
    expect(predicate('http://10.0.0.7:32100')).toBe(true)
  })

  test('still rejects a different port', () => {
    expect(predicate('http://192.168.1.5:8080')).toBe(false)
  })
})
