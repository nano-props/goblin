import { describe, expect, test } from 'vitest'
import { formatTerminalId, parseTerminalIdIndex } from '#/shared/terminal-ids.ts'

describe('terminal id helpers', () => {
  test('parses standard terminal ids into 1-based indexes', () => {
    expect(parseTerminalIdIndex('terminal-1')).toBe(1)
    expect(parseTerminalIdIndex('terminal-42')).toBe(42)
  })

  test('rejects non-standard terminal ids', () => {
    expect(parseTerminalIdIndex('terminal-0')).toBeNull()
    expect(parseTerminalIdIndex('terminal-x')).toBeNull()
    expect(parseTerminalIdIndex('term-1')).toBeNull()
  })

  test('formats standard terminal ids', () => {
    expect(formatTerminalId(3)).toBe('terminal-3')
  })
})
