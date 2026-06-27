import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { terminalSessionScope } from '#/server/terminal/terminal-session-scope.ts'

describe('terminalSessionScope', () => {
  test('normalizes local repo roots into canonical session scope', () => {
    expect(terminalSessionScope('/repo')).toBe(path.resolve('/repo'))
    expect(terminalSessionScope('./repo')).toBe(path.resolve('./repo'))
  })

  test('preserves remote repo roots as opaque session scopes', () => {
    expect(terminalSessionScope('ssh-config://prod/%2Frepo')).toBe('ssh-config://prod/%2Frepo')
  })
})
