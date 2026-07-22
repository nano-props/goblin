import { describe, expect, test } from 'vitest'
import * as v from 'valibot'
import { IpcError } from '#/shared/api-types.ts'
import { createRouteApp, parseHttpBody, parseHttpInput } from '#/server/common/http-validate.ts'
import { OperationCancelledError } from '#/shared/operation-cancelled.ts'

describe('parseHttpInput', () => {
  test('returns the parsed output for valid input', () => {
    const schema = v.object({ cwd: v.string(), branch: v.optional(v.string()) })
    const result = parseHttpInput(schema, { cwd: '/tmp/repo', branch: 'main' })
    expect(result).toEqual({ cwd: '/tmp/repo', branch: 'main' })
  })

  test('throws BAD_REQUEST IpcError for missing required field', () => {
    const schema = v.object({ cwd: v.string() })
    expect(() => parseHttpInput(schema, {})).toThrow(IpcError)
    try {
      parseHttpInput(schema, {})
    } catch (err) {
      expect(err).toBeInstanceOf(IpcError)
      expect((err as IpcError).code).toBe('BAD_REQUEST')
      expect((err as IpcError).message).toContain('cwd')
    }
  })

  test('throws BAD_REQUEST IpcError for wrong type', () => {
    const schema = v.object({ cwd: v.string() })
    expect(() => parseHttpInput(schema, { cwd: 123 })).toThrow(IpcError)
  })

  test('rejects null and non-object inputs', () => {
    const schema = v.object({ cwd: v.string() })
    expect(() => parseHttpInput(schema, null)).toThrow(IpcError)
    expect(() => parseHttpInput(schema, 'string')).toThrow(IpcError)
    expect(() => parseHttpInput(schema, 42)).toThrow(IpcError)
  })
})

describe('parseHttpBody', () => {
  function makeContext(raw: string, contentType = 'application/json') {
    return { req: { header: () => contentType, text: async () => raw } }
  }
  const schema = v.object({ cwd: v.string() })

  test('parses a well-formed JSON object', async () => {
    const out = await parseHttpBody(schema, makeContext('{"cwd":"/tmp/repo"}'))
    expect(out).toEqual({ cwd: '/tmp/repo' })
  })

  test('treats an empty body as undefined so the schema can decide', async () => {
    // Schema requires cwd, so this should throw BAD_REQUEST.
    await expect(parseHttpBody(schema, makeContext(''))).rejects.toThrow(IpcError)
  })

  test('throws BAD_REQUEST with a clear message for malformed JSON', async () => {
    try {
      await parseHttpBody(schema, makeContext('{ not json'))
      expect.fail('expected to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(IpcError)
      expect((err as IpcError).code).toBe('BAD_REQUEST')
      expect((err as IpcError).message).toBe('Request body is not valid JSON')
    }
  })

  test('propagates schema validation errors as BAD_REQUEST', async () => {
    await expect(parseHttpBody(schema, makeContext('{"branch":"main"}'))).rejects.toThrow(IpcError)
  })

  test('rejects a JSON-shaped body with the wrong media type', async () => {
    await expect(parseHttpBody(schema, makeContext('{"cwd":"/tmp/repo"}', 'text/plain'))).rejects.toMatchObject({
      code: 'UNSUPPORTED_MEDIA_TYPE',
      message: 'Content-Type must be application/json',
    })
  })

  test('accepts application/json parameters case-insensitively', async () => {
    await expect(
      parseHttpBody(schema, makeContext('{"cwd":"/tmp/repo"}', 'Application/JSON; Charset=UTF-8')),
    ).resolves.toEqual({ cwd: '/tmp/repo' })
  })
})

describe('createRouteApp', () => {
  test('classifies an aborted request as client cancellation instead of an internal error', async () => {
    const app = createRouteApp()
    const controller = new AbortController()
    app.get('/cancelled', () => {
      controller.abort(new Error('client disconnected'))
      throw new OperationCancelledError()
    })

    const response = await app.request(new Request('http://localhost/cancelled', { signal: controller.signal }))
    expect(response.status).toBe(499)
    expect(await response.text()).toBe('')
  })

  test('keeps a non-aborted unexpected error on the internal-error path', async () => {
    const app = createRouteApp()
    app.get('/failed', () => {
      throw new Error('git failed')
    })

    const response = await app.request('http://localhost/failed')
    expect(response.status).toBe(500)
  })
})
