import { describe, expect, test } from 'vitest'
import { syncTerminalRuntimeSessionIdIndex } from '#/web/components/terminal/terminal-session-index.ts'

describe('terminal session index helper', () => {
  test('updates full runtime bindings and generation-aware reverse maps coherently', () => {
    const terminalRuntimeBindingByTerminalSessionId = new Map<
      string,
      { terminalRuntimeSessionId: string; terminalRuntimeGeneration: number }
    >()
    const terminalSessionIdByTerminalRuntimeSessionId = new Map<string, Map<number, string>>()

    syncTerminalRuntimeSessionIdIndex({
      terminalSessionId: 'term-111111111111111111111',
      terminalRuntimeBinding: {
        terminalRuntimeSessionId: 'pty_session_a_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
      },
      terminalRuntimeBindingByTerminalSessionId,
      terminalSessionIdByTerminalRuntimeSessionId,
    })
    expect(terminalRuntimeBindingByTerminalSessionId.get('term-111111111111111111111')).toEqual({
      terminalRuntimeSessionId: 'pty_session_a_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
    })
    expect(terminalSessionIdByTerminalRuntimeSessionId.get('pty_session_a_aaaaaaaaa')?.get(1)).toBe(
      'term-111111111111111111111',
    )

    syncTerminalRuntimeSessionIdIndex({
      terminalSessionId: 'term-111111111111111111111',
      terminalRuntimeBinding: {
        terminalRuntimeSessionId: 'pty_session_a_aaaaaaaaa',
        terminalRuntimeGeneration: 2,
      },
      terminalRuntimeBindingByTerminalSessionId,
      terminalSessionIdByTerminalRuntimeSessionId,
    })
    expect(terminalSessionIdByTerminalRuntimeSessionId.get('pty_session_a_aaaaaaaaa')?.has(1)).toBe(false)
    expect(terminalSessionIdByTerminalRuntimeSessionId.get('pty_session_a_aaaaaaaaa')?.get(2)).toBe(
      'term-111111111111111111111',
    )

    syncTerminalRuntimeSessionIdIndex({
      terminalSessionId: 'term-111111111111111111111',
      terminalRuntimeBinding: null,
      terminalRuntimeBindingByTerminalSessionId,
      terminalSessionIdByTerminalRuntimeSessionId,
    })
    expect(terminalRuntimeBindingByTerminalSessionId.has('term-111111111111111111111')).toBe(false)
    expect(terminalSessionIdByTerminalRuntimeSessionId.has('pty_session_a_aaaaaaaaa')).toBe(false)
  })
})
