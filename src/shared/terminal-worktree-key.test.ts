import { describe, expect, test } from 'vitest'
import { formatTerminalWorktreeKey, parseTerminalWorktreeKey } from '#/shared/terminal-worktree-key.ts'

describe('terminal worktree key', () => {
  test('formats and parses repo/worktree identity', () => {
    const key = formatTerminalWorktreeKey('/repo', '/repo/worktree')

    expect(key).toBe('/repo\0/repo/worktree')
    expect(parseTerminalWorktreeKey(key)).toEqual({
      repoRoot: '/repo',
      worktreePath: '/repo/worktree',
    })
  })

  test('rejects malformed keys', () => {
    expect(parseTerminalWorktreeKey('')).toBeNull()
    expect(parseTerminalWorktreeKey('/repo')).toBeNull()
    expect(parseTerminalWorktreeKey('/repo\0')).toBeNull()
    expect(parseTerminalWorktreeKey('\0/worktree')).toBeNull()
    expect(parseTerminalWorktreeKey('/repo\0/worktree\0extra')).toBeNull()
  })
})
