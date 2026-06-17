import { describe, expect, test } from 'vitest'
import {
  formatTerminalSessionKey,
  formatWorktreeTerminalKey,
  parseTerminalSessionKey,
  parseWorktreeTerminalKey,
  terminalPruneKeyFromSessionKey,
} from '#/shared/terminal-session-key.ts'

describe('terminal session key helpers', () => {
  test('formats and parses terminal session keys round-trip', () => {
    const key = formatTerminalSessionKey('/repo', '/repo/worktree', 'terminal-2')
    expect(key).toBe('/repo\0/repo/worktree\0terminal-2')
    expect(parseTerminalSessionKey(key)).toEqual({
      repoRoot: '/repo',
      worktreePath: '/repo/worktree',
      terminalId: 'terminal-2',
    })
  })

  test('rejects malformed terminal session keys', () => {
    expect(parseTerminalSessionKey('')).toBeNull()
    expect(parseTerminalSessionKey('/repo')).toBeNull()
    expect(parseTerminalSessionKey('/repo\0/worktree')).toBeNull()
    expect(parseTerminalSessionKey('/repo\0/worktree\0')).toBeNull()
    expect(parseTerminalSessionKey('\0/worktree\0terminal-1')).toBeNull()
  })

  test('formats and parses worktree terminal keys round-trip', () => {
    const key = formatWorktreeTerminalKey('/repo', '/repo/worktree')
    expect(key).toBe('/repo\0/repo/worktree')
    expect(parseWorktreeTerminalKey(key)).toEqual({
      repoRoot: '/repo',
      worktreePath: '/repo/worktree',
    })
  })

  test('rejects malformed worktree terminal keys', () => {
    expect(parseWorktreeTerminalKey('')).toBeNull()
    expect(parseWorktreeTerminalKey('/repo')).toBeNull()
    expect(parseWorktreeTerminalKey('/repo\0')).toBeNull()
    expect(parseWorktreeTerminalKey('\0/worktree')).toBeNull()
    expect(parseWorktreeTerminalKey('/repo\0/worktree\0terminal-1')).toBeNull()
  })

  test('builds prune keys from valid session keys only', () => {
    expect(terminalPruneKeyFromSessionKey('/repo\0/repo/worktree\0terminal-3')).toBe('/repo\0/repo/worktree')
    expect(terminalPruneKeyFromSessionKey('invalid')).toBeNull()
  })
})
