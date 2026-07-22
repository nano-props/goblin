import { describe, expect, test } from 'vitest'
import * as v from 'valibot'
import { ExecResultResponseSchema } from '#/shared/http-response-schema.ts'
import {
  RepoLogResponseSchema,
  RepoProjectionResponseSchema,
  RepoRemoteBranchesResponseSchema,
} from '#/shared/repo-response-schema.ts'

describe('repo response schemas', () => {
  test('accepts legal empty repository reads', () => {
    expect(v.parse(RepoRemoteBranchesResponseSchema, [])).toEqual([])
    expect(v.parse(RepoLogResponseSchema, [])).toEqual([])
    expect(
      v.parse(RepoProjectionResponseSchema, {
        snapshot: null,
        pullRequests: null,
        requested: { branch: null, pullRequestMode: 'full' },
        loadedAt: 1,
      }),
    ).toMatchObject({ snapshot: null, pullRequests: null })
  })

  test('rejects malformed and forward-incompatible mutation envelopes', () => {
    expect(v.safeParse(ExecResultResponseSchema, { ok: true }).success).toBe(false)
    expect(v.safeParse(ExecResultResponseSchema, { ok: true, message: 'ok', legacy: true }).success).toBe(false)
  })

  test('rejects a malformed member instead of turning a list into an empty result', () => {
    expect(v.safeParse(RepoRemoteBranchesResponseSchema, ['origin/main', 42]).success).toBe(false)
    expect(v.safeParse(RepoLogResponseSchema, [{ hash: 'abc' }]).success).toBe(false)
  })
})
