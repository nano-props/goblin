import { describe, expect, test } from 'vitest'
import { safeEqualString } from '#/server/common/timing-safe.ts'

describe('safeEqualString', () => {
  test('returns true for identical strings', async () => {
    expect(safeEqualString('abc123', 'abc123')).toBe(true)
  })

  test('returns false for different strings of the same length', async () => {
    expect(safeEqualString('abc123', 'abc124')).toBe(false)
  })

  test('returns false for strings of different length', async () => {
    expect(safeEqualString('abc', 'abcd')).toBe(false)
    expect(safeEqualString('abcd', 'abc')).toBe(false)
  })

  test('returns false when either side is empty', async () => {
    expect(safeEqualString('', '')).toBe(false)
    expect(safeEqualString('', 'abc')).toBe(false)
    expect(safeEqualString('abc', '')).toBe(false)
  })

  test('handles unicode safely', async () => {
    expect(safeEqualString('密钥', '密钥')).toBe(true)
    expect(safeEqualString('密钥', '秘钥')).toBe(false)
  })
})
