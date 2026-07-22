import { describe, expect, test } from 'vitest'
import { resolveApiBaseUrl, resolveWebSocketProtocol } from '#/web/lib/websocket-url.ts'

describe('server URL resolution', () => {
  test('preserves the authoritative server origin instead of substituting the page origin', () => {
    expect(resolveApiBaseUrl('http://127.0.0.1:32101/')).toBe('http://127.0.0.1:32101/')
  })

  test('derives the WebSocket protocol from the authoritative server URL', () => {
    expect(resolveWebSocketProtocol('http://127.0.0.1:32101/')).toBe('ws:')
    expect(resolveWebSocketProtocol('https://example.test/')).toBe('wss:')
  })
})
