import { describe, expect, it } from 'vitest'
import { deriveOwnerId } from '#/server/common/identity.ts'

describe('deriveOwnerId', () => {
  it('returns a stable id for the same token', () => {
    const a = deriveOwnerId('token-a')
    const b = deriveOwnerId('token-a')
    expect(a).toBe(b)
  })

  it('returns different ids for different tokens', () => {
    const a = deriveOwnerId('token-a')
    const b = deriveOwnerId('token-b')
    expect(a).not.toBe(b)
  })

  it('prefixes the id with `owner_` so log lines and Map keys are unambiguous', () => {
    expect(deriveOwnerId('token-c').startsWith('owner_')).toBe(true)
  })

  it('produces ids of the same length regardless of input length', () => {
    // 32 hex chars (128 bits) + `owner_` prefix = 38 chars total
    expect(deriveOwnerId('x').length).toBe(deriveOwnerId('a'.repeat(1024)).length)
    expect(deriveOwnerId('x')).toMatch(/^owner_[0-9a-f]{32}$/)
  })

  it('does not throw on an empty token (returns the empty-token hash)', () => {
    // The middleware above the call site guarantees a non-empty
    // token, but the helper itself must not throw — defense in depth.
    expect(() => deriveOwnerId('')).not.toThrow()
  })
})
