import { describe, expect, test } from 'vitest'
import { syncTerminalSessionIdIndex } from '#/web/components/terminal/terminal-slot-index.ts'

describe('terminal session index helper', () => {
  test('updates both key->session and session->key maps coherently', () => {
    const sessionIdByKey = new Map<string, string>()
    const slotKeyByPtySessionId = new Map<string, string>()

    syncTerminalSessionIdIndex({
      key: 'slot-1',
      ptySessionId: 'pty_session_a_aaaaaaaaa',
      sessionIdByKey,
      slotKeyByPtySessionId,
    })
    expect(sessionIdByKey.get('slot-1')).toBe('pty_session_a_aaaaaaaaa')
    expect(slotKeyByPtySessionId.get('pty_session_a_aaaaaaaaa')).toBe('slot-1')

    syncTerminalSessionIdIndex({
      key: 'slot-1',
      ptySessionId: 'pty_session_b_aaaaaaaaa',
      sessionIdByKey,
      slotKeyByPtySessionId,
    })
    expect(slotKeyByPtySessionId.has('pty_session_a_aaaaaaaaa')).toBe(false)
    expect(slotKeyByPtySessionId.get('pty_session_b_aaaaaaaaa')).toBe('slot-1')

    syncTerminalSessionIdIndex({
      key: 'slot-1',
      ptySessionId: null,
      sessionIdByKey,
      slotKeyByPtySessionId,
    })
    expect(sessionIdByKey.has('slot-1')).toBe(false)
  })
})
