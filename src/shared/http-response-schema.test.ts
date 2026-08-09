import { describe, expect, test } from 'vitest'
import * as v from 'valibot'
import { decodeWith } from '#/shared/http-response-schema.ts'

describe('HTTP response decoding', () => {
  test('reports the failing response path', () => {
    const decode = decodeWith(
      v.strictObject({ runtime: v.strictObject({ workspaces: v.array(v.strictObject({ id: v.string() })) }) }),
    )

    let thrown: unknown
    try {
      decode({ runtime: { workspaces: [{ id: 1 }] } })
    } catch (error) {
      thrown = error
    }

    expect(v.isValiError(thrown)).toBe(true)
    expect(thrown).toBeInstanceOf(v.ValiError)
    if (!v.isValiError(thrown)) throw new Error('Expected a Valibot error')
    expect(thrown.message).toContain('runtime.workspaces.0.id')
  })
})
