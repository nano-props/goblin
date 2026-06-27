import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { terminalSlotScope } from '#/server/terminal/terminal-slot-scope.ts'

describe('terminalSlotScope', () => {
  test('normalizes local repo roots into canonical session scope', () => {
    expect(terminalSlotScope('/repo')).toBe(path.resolve('/repo'))
    expect(terminalSlotScope('./repo')).toBe(path.resolve('./repo'))
  })

  test('preserves remote repo roots as opaque session scopes', () => {
    expect(terminalSlotScope('ssh-config://prod/%2Frepo')).toBe('ssh-config://prod/%2Frepo')
  })
})
