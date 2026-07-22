import { describe, expect, test } from 'vitest'
import * as v from 'valibot'
import { decodeWith } from '#/shared/http-response-schema.ts'

describe('HTTP response decoding', () => {
  test('reports the failing response path', () => {
    const decode = decodeWith(
      v.strictObject({ runtime: v.strictObject({ workspaces: v.array(v.strictObject({ id: v.string() })) }) }),
    )

    expect(() => decode({ runtime: { workspaces: [{ id: 1 }] } })).toThrow(
      'runtime.workspaces.0.id',
    )
  })
})
