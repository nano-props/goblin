import { describe, expect, test } from 'vitest'
import { syncTerminalPtySessionIdIndex } from '#/web/components/terminal/terminal-session-index.ts'

describe('terminal session index helper', () => {
  test('updates both key->session and session->key maps coherently', () => {
    const ptySessionIdByKey = new Map<string, string>()
    const sessionKeyByPtySessionId = new Map<string, string>()

    syncTerminalPtySessionIdIndex({
      key: 'session-1',
      ptySessionId: 'pty_session_a_aaaaaaaaa',
      ptySessionIdByKey,
      sessionKeyByPtySessionId,
    })
    expect(ptySessionIdByKey.get('session-1')).toBe('pty_session_a_aaaaaaaaa')
    expect(sessionKeyByPtySessionId.get('pty_session_a_aaaaaaaaa')).toBe('session-1')

    syncTerminalPtySessionIdIndex({
      key: 'session-1',
      ptySessionId: 'pty_session_b_aaaaaaaaa',
      ptySessionIdByKey,
      sessionKeyByPtySessionId,
    })
    expect(sessionKeyByPtySessionId.has('pty_session_a_aaaaaaaaa')).toBe(false)
    expect(sessionKeyByPtySessionId.get('pty_session_b_aaaaaaaaa')).toBe('session-1')

    syncTerminalPtySessionIdIndex({
      key: 'session-1',
      ptySessionId: null,
      ptySessionIdByKey,
      sessionKeyByPtySessionId,
    })
    expect(ptySessionIdByKey.has('session-1')).toBe(false)
  })
})
