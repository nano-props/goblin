import { describe, expect, test } from 'vitest'
import { syncTerminalRuntimeSessionIdIndex } from '#/web/components/terminal/terminal-session-index.ts'

describe('terminal session index helper', () => {
  test('updates terminalSessionId and terminalRuntimeSessionId maps coherently', () => {
    const terminalRuntimeSessionIdByTerminalSessionId = new Map<string, string>()
    const terminalSessionIdByTerminalRuntimeSessionId = new Map<string, string>()

    syncTerminalRuntimeSessionIdIndex({
      terminalSessionId: 'term-111111111111111111111',
      terminalRuntimeSessionId: 'pty_session_a_aaaaaaaaa',
      terminalRuntimeSessionIdByTerminalSessionId,
      terminalSessionIdByTerminalRuntimeSessionId,
    })
    expect(terminalRuntimeSessionIdByTerminalSessionId.get('term-111111111111111111111')).toBe('pty_session_a_aaaaaaaaa')
    expect(terminalSessionIdByTerminalRuntimeSessionId.get('pty_session_a_aaaaaaaaa')).toBe('term-111111111111111111111')

    syncTerminalRuntimeSessionIdIndex({
      terminalSessionId: 'term-111111111111111111111',
      terminalRuntimeSessionId: 'pty_session_b_aaaaaaaaa',
      terminalRuntimeSessionIdByTerminalSessionId,
      terminalSessionIdByTerminalRuntimeSessionId,
    })
    expect(terminalSessionIdByTerminalRuntimeSessionId.has('pty_session_a_aaaaaaaaa')).toBe(false)
    expect(terminalSessionIdByTerminalRuntimeSessionId.get('pty_session_b_aaaaaaaaa')).toBe('term-111111111111111111111')

    syncTerminalRuntimeSessionIdIndex({
      terminalSessionId: 'term-111111111111111111111',
      terminalRuntimeSessionId: null,
      terminalRuntimeSessionIdByTerminalSessionId,
      terminalSessionIdByTerminalRuntimeSessionId,
    })
    expect(terminalRuntimeSessionIdByTerminalSessionId.has('term-111111111111111111111')).toBe(false)
  })
})
