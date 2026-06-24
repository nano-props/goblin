import { describe, expect, test } from 'vitest'
import * as v from 'valibot'
import { IpcError } from '#/shared/api-types.ts'
import { parseHttpBody, parseHttpInput } from '#/server/common/http-validate.ts'

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
  function makeContext(raw: string) {
    return { req: { text: async () => raw } }
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
})
