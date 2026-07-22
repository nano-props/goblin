import * as v from 'valibot'
import { describe, expect, test, vi } from 'vitest'
import { createHttpTransport, TransportError } from '#/server/g-command/transport.ts'

const ResultSchema = v.strictObject({ ok: v.literal(true) })
const decodeResult = (value: unknown): v.InferOutput<typeof ResultSchema> => v.parse(ResultSchema, value)

function env(): NodeJS.ProcessEnv {
  return {
    GOBLIN_SERVER_URL: 'http://127.0.0.1:32099',
    GOBLIN_SERVER_ACCESS_TOKEN: 'test-token',
  }
}

describe('g command HTTP transport', () => {
  test('decodes a successful response at the transport boundary', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true }))
    const transport = createHttpTransport(env(), fetchImpl)

    await expect(transport.postJson('/api/test', {}, decodeResult)).resolves.toEqual({ ok: true })
  })

  test.each([
    ['a malformed response', { ok: 'yes' }],
    ['a response with unknown fields', { ok: true, legacy: true }],
  ])('rejects %s', async (_label, payload) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload))
    const transport = createHttpTransport(env(), fetchImpl)

    await expect(transport.postJson('/api/test', {}, decodeResult)).rejects.toEqual(
      new TransportError('server returned an invalid response'),
    )
  })

  test('rejects invalid JSON on a successful response', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('not-json'))
    const transport = createHttpTransport(env(), fetchImpl)

    await expect(transport.postJson('/api/test', {}, decodeResult)).rejects.toEqual(
      new TransportError('server returned invalid JSON'),
    )
  })

  test('uses only a strict error envelope for server detail', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ message: 'unavailable' }, { status: 503 }))
      .mockResolvedValueOnce(
        Response.json({ ok: false, code: 'NO_CLIENT', message: 'no client' }, { status: 503 }),
      )
      .mockResolvedValueOnce(Response.json({ message: 'unavailable', legacy: true }, { status: 503 }))
    const transport = createHttpTransport(env(), fetchImpl)

    await expect(transport.postJson('/api/test', {}, decodeResult)).rejects.toEqual(
      new TransportError('request failed (503): unavailable'),
    )
    await expect(transport.postJson('/api/test', {}, decodeResult)).rejects.toEqual(
      new TransportError('request failed (503): no client'),
    )
    await expect(transport.postJson('/api/test', {}, decodeResult)).rejects.toEqual(
      new TransportError('request failed (503)'),
    )
  })
})
