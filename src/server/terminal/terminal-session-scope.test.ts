import { describe, expect, test } from 'vitest'
import { terminalSessionScope, terminalSessionWorktreePath } from '#/server/terminal/terminal-session-scope.ts'

describe('terminalSessionScope', () => {
  test('preserves canonical local workspace identity as the session scope', () => {
    expect(terminalSessionScope('goblin+file:///repo')).toBe('goblin+file:///repo')
    expect(() => terminalSessionScope('/repo')).toThrow('error.workspace-locator-malformed')
  })

  test('preserves remote repo roots as opaque session scopes', () => {
    expect(terminalSessionScope('goblin+ssh://prod/%252Frepo')).toBe('goblin+ssh://prod/%252Frepo')
  })

  test('normalizes local worktrees and preserves remote worktree paths', () => {
    expect(terminalSessionWorktreePath('goblin+file:///repo', './repo-worktree')).toMatch(/repo-worktree$/)
    expect(terminalSessionWorktreePath('goblin+file:///repo', 'goblin+file:///repo')).toBe('/repo')
    expect(terminalSessionWorktreePath('goblin+ssh://prod/%252Frepo', '/srv/repo')).toBe('/srv/repo')
    expect(terminalSessionWorktreePath('goblin+ssh://prod/srv/repo', 'goblin+ssh://prod/srv/repo')).toBe('/srv/repo')
  })
})
