import { describe, expect, test } from 'vitest'
import { syncTerminalSessionIdIndex } from '#/web/components/terminal/terminal-session-index.ts'

describe('terminal session index helper', () => {
  test('updates both key->session and session->key maps coherently', () => {
    const sessionIdByKey = new Map<string, string>()
    const sessionKeyBySessionId = new Map<string, string>()

    syncTerminalSessionIdIndex({
      key: 'terminal-1',
      sessionId: 'session-a',
      sessionIdByKey,
      sessionKeyBySessionId,
    })
    expect(sessionIdByKey.get('terminal-1')).toBe('session-a')
    expect(sessionKeyBySessionId.get('session-a')).toBe('terminal-1')

    syncTerminalSessionIdIndex({
      key: 'terminal-1',
      sessionId: 'session-b',
      sessionIdByKey,
      sessionKeyBySessionId,
    })
    expect(sessionKeyBySessionId.has('session-a')).toBe(false)
    expect(sessionKeyBySessionId.get('session-b')).toBe('terminal-1')

    syncTerminalSessionIdIndex({
      key: 'terminal-1',
      sessionId: null,
      sessionIdByKey,
      sessionKeyBySessionId,
    })
    expect(sessionIdByKey.has('terminal-1')).toBe(false)
  })
})
