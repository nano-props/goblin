import { describe, expect, test } from 'vitest'
import { syncTerminalPtySessionIdIndex } from '#/web/components/terminal/terminal-slot-index.ts'

describe('terminal slot index helper', () => {
  test('updates both key->session and session->key maps coherently', () => {
    const ptySessionIdByKey = new Map<string, string>()
    const slotKeyByPtySessionId = new Map<string, string>()

    syncTerminalPtySessionIdIndex({
      key: 'slot-1',
      ptySessionId: 'pty_session_a_aaaaaaaaa',
      ptySessionIdByKey,
      slotKeyByPtySessionId,
    })
    expect(ptySessionIdByKey.get('slot-1')).toBe('pty_session_a_aaaaaaaaa')
    expect(slotKeyByPtySessionId.get('pty_session_a_aaaaaaaaa')).toBe('slot-1')

    syncTerminalPtySessionIdIndex({
      key: 'slot-1',
      ptySessionId: 'pty_session_b_aaaaaaaaa',
      ptySessionIdByKey,
      slotKeyByPtySessionId,
    })
    expect(slotKeyByPtySessionId.has('pty_session_a_aaaaaaaaa')).toBe(false)
    expect(slotKeyByPtySessionId.get('pty_session_b_aaaaaaaaa')).toBe('slot-1')

    syncTerminalPtySessionIdIndex({
      key: 'slot-1',
      ptySessionId: null,
      ptySessionIdByKey,
      slotKeyByPtySessionId,
    })
    expect(ptySessionIdByKey.has('slot-1')).toBe(false)
  })
})
