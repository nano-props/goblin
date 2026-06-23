import { describe, expect, test } from 'vitest'
import { syncTerminalSessionIdIndex } from '#/web/components/terminal/terminal-session-index.ts'

describe('terminal session index helper', () => {
  test('updates both key->session and session->key maps coherently', () => {
    const sessionIdByKey = new Map<string, string>()
    const slotKeyByPtySessionId = new Map<string, string>()

    syncTerminalSessionIdIndex({
      key: 'terminal-1',
      ptySessionId: 'session-a',
      sessionIdByKey,
      slotKeyByPtySessionId,
    })
    expect(sessionIdByKey.get('terminal-1')).toBe('session-a')
    expect(slotKeyByPtySessionId.get('session-a')).toBe('terminal-1')

    syncTerminalSessionIdIndex({
      key: 'terminal-1',
      ptySessionId: 'session-b',
      sessionIdByKey,
      slotKeyByPtySessionId,
    })
    expect(slotKeyByPtySessionId.has('session-a')).toBe(false)
    expect(slotKeyByPtySessionId.get('session-b')).toBe('terminal-1')

    syncTerminalSessionIdIndex({
      key: 'terminal-1',
      ptySessionId: null,
      sessionIdByKey,
      slotKeyByPtySessionId,
    })
    expect(sessionIdByKey.has('terminal-1')).toBe(false)
  })
})
