import { describe, expect, test } from 'vitest'
import {
  formatTerminalWorktreeKey,
  formatTerminalWorktreeKeyForPath,
  parseTerminalWorktreeKey,
} from '#/shared/terminal-worktree-key.ts'

describe('terminal worktree key', () => {
  test('formats and parses repo/worktree identity', () => {
    const key = formatTerminalWorktreeKey('goblin+file:///repo', 'goblin+file:///repo/worktree')

    expect(key).toBe('goblin+file:///repo\0goblin+file:///repo/worktree')
    expect(parseTerminalWorktreeKey(key)).toEqual({
      repoRoot: 'goblin+file:///repo',
      worktreeId: 'goblin+file:///repo/worktree',
    })
  })

  test.each([
    ['goblin+file:///repo', '/repo/worktree', 'goblin+file:///repo/worktree'],
    ['goblin+ssh://dev/srv/repo', '/srv/repo/worktree', 'goblin+ssh://dev/srv/repo/worktree'],
  ])('binds a native path to the workspace transport for %s', (repoRoot, path, worktreeId) => {
    expect(formatTerminalWorktreeKeyForPath(repoRoot, path)).toBe(`${repoRoot}\0${worktreeId}`)
  })

  test.each([
    ['goblin+file:///repo', 'goblin+file:///repo/worktree'],
    ['goblin+ssh://dev/srv/repo', 'goblin+ssh://dev/srv/repo/worktree'],
  ])('keeps an already canonical worktree identity idempotent for %s', (repoRoot, worktreeId) => {
    expect(formatTerminalWorktreeKeyForPath(repoRoot, worktreeId)).toBe(`${repoRoot}\0${worktreeId}`)
  })

  test.each([
    ['goblin+file:///repo', 'goblin+ssh://dev/srv/repo'],
    ['goblin+ssh://dev/srv/repo', 'goblin+file:///repo'],
    ['goblin+ssh://dev/srv/repo', 'goblin+ssh://other/srv/repo'],
  ])('rejects an incompatible canonical worktree identity', (repoRoot, worktreeId) => {
    expect(() => formatTerminalWorktreeKeyForPath(repoRoot, worktreeId)).toThrow(
      'terminal worktree key requires compatible canonical workspace roots',
    )
  })

  test('rejects raw paths at the canonical identity formatter boundary', () => {
    expect(() => formatTerminalWorktreeKey('/repo', '/repo/worktree')).toThrow(
      'terminal worktree key requires compatible canonical workspace roots',
    )
  })

  test('rejects malformed keys', () => {
    expect(parseTerminalWorktreeKey('')).toBeNull()
    expect(parseTerminalWorktreeKey('/repo')).toBeNull()
    expect(parseTerminalWorktreeKey('/repo\0')).toBeNull()
    expect(parseTerminalWorktreeKey('\0/worktree')).toBeNull()
    expect(parseTerminalWorktreeKey('/repo\0/worktree\0extra')).toBeNull()
  })
})
