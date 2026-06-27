import { describe, expect, test } from 'vitest'
import { formatTerminalSessionId, parseTerminalSessionIdIndex } from '#/shared/terminal-session-id-format.ts'

describe('terminal session id format helpers', () => {
  test('parses standard slot ids into 1-based indexes', () => {
    expect(parseTerminalSessionIdIndex('session-1')).toBe(1)
    expect(parseTerminalSessionIdIndex('session-42')).toBe(42)
  })

  test('rejects non-standard slot ids', () => {
    expect(parseTerminalSessionIdIndex('session-0')).toBeNull()
    expect(parseTerminalSessionIdIndex('session-x')).toBeNull()
    expect(parseTerminalSessionIdIndex('term-1')).toBeNull()
  })

  test('formats standard slot ids', () => {
    expect(formatTerminalSessionId(3)).toBe('session-3')
  })
})
