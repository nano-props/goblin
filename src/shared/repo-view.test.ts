import * as v from 'valibot'
import { describe, expect, test } from 'vitest'
import { RepoViewResultSchema } from '#/shared/repo-view.ts'

describe('repo view response schema', () => {
  test('accepts the current success and failure contracts', () => {
    expect(v.parse(RepoViewResultSchema, { ok: true })).toEqual({ ok: true })
    expect(v.parse(RepoViewResultSchema, { ok: false, code: 'NO_CLIENT', message: 'no client' })).toEqual({
      ok: false,
      code: 'NO_CLIENT',
      message: 'no client',
    })
  })

  test.each([
    { ok: 'yes' },
    { ok: true, legacy: true },
    { ok: false, message: 'no client' },
    { ok: false, code: 'NO_CLIENT', message: 'no client', legacy: true },
  ])('rejects malformed or non-current responses: %j', (value) => {
    expect(v.safeParse(RepoViewResultSchema, value).success).toBe(false)
  })
})
