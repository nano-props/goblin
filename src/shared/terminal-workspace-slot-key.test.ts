import { describe, expect, test } from 'vitest'
import {
  formatTerminalWorkspaceSlotKey,
  formatWorktreeKey,
  parseTerminalWorkspaceSlotKey,
  parseWorktreeKey,
  terminalPruneKeyFromSlotKey,
} from '#/shared/terminal-workspace-slot-key.ts'

describe('terminal workspace slot key helpers', () => {
  test('formats and parses terminal workspace slot keys round-trip', () => {
    const key = formatTerminalWorkspaceSlotKey('/repo', '/repo/worktree', 'session-2')
    expect(key).toBe('/repo\0/repo/worktree\0session-2')
    expect(parseTerminalWorkspaceSlotKey(key)).toEqual({
      repoRoot: '/repo',
      worktreePath: '/repo/worktree',
      sessionId: 'session-2',
    })
  })

  test('rejects malformed terminal workspace slot keys', () => {
    expect(parseTerminalWorkspaceSlotKey('')).toBeNull()
    expect(parseTerminalWorkspaceSlotKey('/repo')).toBeNull()
    expect(parseTerminalWorkspaceSlotKey('/repo\0/worktree')).toBeNull()
    expect(parseTerminalWorkspaceSlotKey('/repo\0/worktree\0')).toBeNull()
    expect(parseTerminalWorkspaceSlotKey('\0/worktree\0session-1')).toBeNull()
  })

  test('formats and parses worktree terminal keys round-trip', () => {
    const key = formatWorktreeKey('/repo', '/repo/worktree')
    expect(key).toBe('/repo\0/repo/worktree')
    expect(parseWorktreeKey(key)).toEqual({
      repoRoot: '/repo',
      worktreePath: '/repo/worktree',
    })
  })

  test('rejects malformed worktree terminal keys', () => {
    expect(parseWorktreeKey('')).toBeNull()
    expect(parseWorktreeKey('/repo')).toBeNull()
    expect(parseWorktreeKey('/repo\0')).toBeNull()
    expect(parseWorktreeKey('\0/worktree')).toBeNull()
    expect(parseWorktreeKey('/repo\0/worktree\0session-1')).toBeNull()
  })

  test('builds prune keys from valid slot keys only', () => {
    expect(terminalPruneKeyFromSlotKey('/repo\0/repo/worktree\0session-3')).toBe('/repo\0/repo/worktree')
    expect(terminalPruneKeyFromSlotKey('invalid')).toBeNull()
  })
})
