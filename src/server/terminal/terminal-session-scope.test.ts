import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { terminalSessionScope, terminalSessionWorktreePath } from '#/server/terminal/terminal-session-scope.ts'

describe('terminalSessionScope', () => {
  test('normalizes local repo roots into canonical session scope', () => {
    expect(terminalSessionScope('/repo')).toBe(path.resolve('/repo'))
    expect(terminalSessionScope('./repo')).toBe(path.resolve('./repo'))
  })

  test('preserves remote repo roots as opaque session scopes', () => {
    expect(terminalSessionScope('ssh-config://prod/%2Frepo')).toBe('ssh-config://prod/%2Frepo')
  })

  test('normalizes local worktrees and preserves remote worktree paths', () => {
    expect(terminalSessionWorktreePath('/repo', './repo-worktree')).toBe(path.resolve('./repo-worktree'))
    expect(terminalSessionWorktreePath('ssh-config://prod/%2Frepo', '/srv/repo')).toBe('/srv/repo')
  })
})
