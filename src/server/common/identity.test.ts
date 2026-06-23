import { describe, expect, it } from 'vitest'
import { deriveUserId } from '#/server/common/identity.ts'

describe('deriveUserId', () => {
  it('returns a stable id for the same token', () => {
    const a = deriveUserId('token-a')
    const b = deriveUserId('token-a')
    expect(a).toBe(b)
  })

  it('returns different ids for different tokens', () => {
    const a = deriveUserId('token-a')
    const b = deriveUserId('token-b')
    expect(a).not.toBe(b)
  })

  it('prefixes the id with `user_` so log lines and Map keys are unambiguous', () => {
    expect(deriveUserId('token-c').startsWith('user_')).toBe(true)
  })

  it('produces ids of the same length regardless of input length', () => {
    // 32 hex chars (128 bits) + `user_` prefix = 37 chars total
    expect(deriveUserId('x').length).toBe(deriveUserId('a'.repeat(1024)).length)
    expect(deriveUserId('x')).toMatch(/^user_[0-9a-f]{32}$/)
  })

  it('does not throw on an empty token (returns the empty-token hash)', () => {
    // The middleware above the call site guarantees a non-empty
    // token, but the helper itself must not throw — defense in depth.
    expect(() => deriveUserId('')).not.toThrow()
  })
})
