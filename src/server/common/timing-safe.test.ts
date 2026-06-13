import { describe, expect, test } from 'vitest'
import { safeEqualString } from '#/server/common/timing-safe.ts'

describe('safeEqualString', () => {
  test('returns true for identical strings', () => {
    expect(safeEqualString('abc123', 'abc123')).toBe(true)
  })

  test('returns false for different strings of the same length', () => {
    expect(safeEqualString('abc123', 'abc124')).toBe(false)
  })

  test('returns false for strings of different length', () => {
    expect(safeEqualString('abc', 'abcd')).toBe(false)
    expect(safeEqualString('abcd', 'abc')).toBe(false)
  })

  test('returns false when either side is empty', () => {
    expect(safeEqualString('', '')).toBe(false)
    expect(safeEqualString('', 'abc')).toBe(false)
    expect(safeEqualString('abc', '')).toBe(false)
  })

  test('handles unicode safely', () => {
    expect(safeEqualString('密钥', '密钥')).toBe(true)
    expect(safeEqualString('密钥', '秘钥')).toBe(false)
  })
})
