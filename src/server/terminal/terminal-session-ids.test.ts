// @vitest-environment node

import { describe, expect, test } from 'vitest'
import { createTerminalSessionId, isValidTerminalSessionId } from '#/server/terminal/terminal-session-ids.ts'

describe('terminal session ids', () => {
  test('creates short canonical terminal session ids', () => {
    expect(createTerminalSessionId()).toMatch(/^term-[A-Za-z0-9_-]{21}$/)
  })

  test('validates only the canonical term-prefixed id shape', () => {
    expect(isValidTerminalSessionId('term-Ov3NVsoo6UO2JeJN5YwHA')).toBe(true)
    expect(isValidTerminalSessionId('terminal-session-Ov3NVsoo6UO2JeJN5YwHA')).toBe(false)
    expect(isValidTerminalSessionId('term-short')).toBe(false)
  })
})
