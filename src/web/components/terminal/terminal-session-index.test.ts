import { describe, expect, test } from 'vitest'
import { syncTerminalPtySessionIdIndex } from '#/web/components/terminal/terminal-session-index.ts'

describe('terminal session index helper', () => {
  test('updates terminalSessionId and ptySessionId maps coherently', () => {
    const ptySessionIdByTerminalSessionId = new Map<string, string>()
    const terminalSessionIdByPtySessionId = new Map<string, string>()

    syncTerminalPtySessionIdIndex({
      terminalSessionId: 'session-1',
      ptySessionId: 'pty_session_a_aaaaaaaaa',
      ptySessionIdByTerminalSessionId,
      terminalSessionIdByPtySessionId,
    })
    expect(ptySessionIdByTerminalSessionId.get('session-1')).toBe('pty_session_a_aaaaaaaaa')
    expect(terminalSessionIdByPtySessionId.get('pty_session_a_aaaaaaaaa')).toBe('session-1')

    syncTerminalPtySessionIdIndex({
      terminalSessionId: 'session-1',
      ptySessionId: 'pty_session_b_aaaaaaaaa',
      ptySessionIdByTerminalSessionId,
      terminalSessionIdByPtySessionId,
    })
    expect(terminalSessionIdByPtySessionId.has('pty_session_a_aaaaaaaaa')).toBe(false)
    expect(terminalSessionIdByPtySessionId.get('pty_session_b_aaaaaaaaa')).toBe('session-1')

    syncTerminalPtySessionIdIndex({
      terminalSessionId: 'session-1',
      ptySessionId: null,
      ptySessionIdByTerminalSessionId,
      terminalSessionIdByPtySessionId,
    })
    expect(ptySessionIdByTerminalSessionId.has('session-1')).toBe(false)
  })
})
