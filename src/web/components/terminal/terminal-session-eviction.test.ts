import { describe, expect, test } from 'vitest'
import {
  countOrphanedTerminalSessionIds,
  resolveAdjacentTerminalSelectionAfterRemoval,
} from '#/web/components/terminal/terminal-session-eviction.ts'

describe('terminal session eviction helpers', () => {
  test('finds orphaned local sessions that no longer exist on the server', () => {
    const orphaned = countOrphanedTerminalSessionIds({
      repoRoot: '/repo',
      localSessionKeys: ['a', 'b', 'c'],
      getRepoRootForKey: (key) => (key === 'c' ? '/other' : '/repo'),
      hasServerPtySessionId: (key) => key !== 'b',
      serverKeys: new Set(['a']),
    })
    expect(orphaned).toEqual([])

    const orphaned2 = countOrphanedTerminalSessionIds({
      repoRoot: '/repo',
      localSessionKeys: ['a', 'b', 'c'],
      getRepoRootForKey: (key) => (key === 'c' ? '/other' : '/repo'),
      hasServerPtySessionId: (key) => key === 'b',
      serverKeys: new Set(['a']),
    })
    expect(orphaned2).toEqual(['b'])
  })

  test('selects the adjacent tab after removing the active terminal', () => {
    expect(resolveAdjacentTerminalSelectionAfterRemoval(['a', 'b', 'c'], 'b')).toBe('c')
    expect(resolveAdjacentTerminalSelectionAfterRemoval(['a', 'b'], 'b')).toBe('a')
    expect(resolveAdjacentTerminalSelectionAfterRemoval(['a'], 'a')).toBeNull()
  })
})
