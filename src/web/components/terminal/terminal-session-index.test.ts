import { describe, expect, test } from 'vitest'
import { syncTerminalPtySessionIdIndex } from '#/web/components/terminal/terminal-session-index.ts'

describe('terminal session index helper', () => {
  test('updates both key->session and session->key maps coherently', () => {
    const ptySessionIdByTerminalKey = new Map<string, string>()
    const terminalKeyByPtySessionId = new Map<string, string>()

    syncTerminalPtySessionIdIndex({
      terminalKey: 'session-1',
      ptySessionId: 'pty_session_a_aaaaaaaaa',
      ptySessionIdByTerminalKey,
      terminalKeyByPtySessionId,
    })
    expect(ptySessionIdByTerminalKey.get('session-1')).toBe('pty_session_a_aaaaaaaaa')
    expect(terminalKeyByPtySessionId.get('pty_session_a_aaaaaaaaa')).toBe('session-1')

    syncTerminalPtySessionIdIndex({
      terminalKey: 'session-1',
      ptySessionId: 'pty_session_b_aaaaaaaaa',
      ptySessionIdByTerminalKey,
      terminalKeyByPtySessionId,
    })
    expect(terminalKeyByPtySessionId.has('pty_session_a_aaaaaaaaa')).toBe(false)
    expect(terminalKeyByPtySessionId.get('pty_session_b_aaaaaaaaa')).toBe('session-1')

    syncTerminalPtySessionIdIndex({
      terminalKey: 'session-1',
      ptySessionId: null,
      ptySessionIdByTerminalKey,
      terminalKeyByPtySessionId,
    })
    expect(ptySessionIdByTerminalKey.has('session-1')).toBe(false)
  })
})
