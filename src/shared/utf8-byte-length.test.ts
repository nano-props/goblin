import { describe, expect, test } from 'vitest'
import { utf8ByteLength } from '#/shared/utf8-byte-length.ts'

describe('utf8ByteLength', () => {
  test('measures ASCII, multibyte characters, and surrogate pairs', () => {
    expect(utf8ByteLength('hello')).toBe(5)
    expect(utf8ByteLength('你')).toBe(3)
    expect(utf8ByteLength('😀')).toBe(4)
  })

  test('counts unpaired surrogates as replacement characters', () => {
    expect(utf8ByteLength('\ud800')).toBe(3)
    expect(utf8ByteLength('\udc00')).toBe(3)
  })
})
