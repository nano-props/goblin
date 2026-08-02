import { describe, expect, test } from 'vitest'
import { formatServerUrl } from '#/shared/server-url.ts'

describe('server URL formatting', () => {
  test.each([
    ['127.0.0.1', 'http://127.0.0.1:32100'],
    ['0.0.0.0', 'http://127.0.0.1:32100'],
    ['::1', 'http://[::1]:32100'],
    ['::', 'http://[::1]:32100'],
    ['[2001:db8::1]', 'http://[2001:db8::1]:32100'],
  ])('formats %s as a client-accessible URL', (host, expected) => {
    expect(formatServerUrl(host, 32100)).toBe(expected)
  })
})
