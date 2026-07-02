import { describe, expect, test } from 'vitest'
import { syncTerminalRuntimeSessionIdIndex } from '#/web/components/terminal/terminal-session-index.ts'

describe('terminal session index helper', () => {
  test('updates terminalSessionId and terminalRuntimeSessionId maps coherently', () => {
    const terminalRuntimeSessionIdByTerminalSessionId = new Map<string, string>()
    const terminalSessionIdByTerminalRuntimeSessionId = new Map<string, string>()

    syncTerminalRuntimeSessionIdIndex({
      terminalSessionId: 'session-1',
      terminalRuntimeSessionId: 'pty_session_a_aaaaaaaaa',
      terminalRuntimeSessionIdByTerminalSessionId,
      terminalSessionIdByTerminalRuntimeSessionId,
    })
    expect(terminalRuntimeSessionIdByTerminalSessionId.get('session-1')).toBe('pty_session_a_aaaaaaaaa')
    expect(terminalSessionIdByTerminalRuntimeSessionId.get('pty_session_a_aaaaaaaaa')).toBe('session-1')

    syncTerminalRuntimeSessionIdIndex({
      terminalSessionId: 'session-1',
      terminalRuntimeSessionId: 'pty_session_b_aaaaaaaaa',
      terminalRuntimeSessionIdByTerminalSessionId,
      terminalSessionIdByTerminalRuntimeSessionId,
    })
    expect(terminalSessionIdByTerminalRuntimeSessionId.has('pty_session_a_aaaaaaaaa')).toBe(false)
    expect(terminalSessionIdByTerminalRuntimeSessionId.get('pty_session_b_aaaaaaaaa')).toBe('session-1')

    syncTerminalRuntimeSessionIdIndex({
      terminalSessionId: 'session-1',
      terminalRuntimeSessionId: null,
      terminalRuntimeSessionIdByTerminalSessionId,
      terminalSessionIdByTerminalRuntimeSessionId,
    })
    expect(terminalRuntimeSessionIdByTerminalSessionId.has('session-1')).toBe(false)
  })
})
