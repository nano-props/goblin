import { describe, expect, test } from 'vitest'
import {
  countOrphanedTerminalSessionIds,
  resolveAdjacentTerminalSelectionAfterRemoval,
} from '#/web/components/terminal/terminal-session-eviction.ts'

describe('terminal session eviction helpers', () => {
  test('finds orphaned local sessions that no longer exist on the server', () => {
    const orphaned = countOrphanedTerminalSessionIds({
      repoRoot: '/repo',
      repoInstanceId: 'repo-instance-test',
      localTerminalSessionIds: ['term-aaaaaaaaaaaaaaaaaaaaa', 'term-bbbbbbbbbbbbbbbbbbbbb', 'term-ccccccccccccccccccccc'],
      getRepoRootForTerminalSessionId: (terminalSessionId) => (terminalSessionId === 'term-ccccccccccccccccccccc' ? '/other' : '/repo'),
      getRepoInstanceIdForTerminalSessionId: () => 'repo-instance-test',
      hasTerminalRuntimeSessionIdForTerminalSessionId: (terminalSessionId) => terminalSessionId !== 'term-bbbbbbbbbbbbbbbbbbbbb',
      serverTerminalSessionIds: new Set(['term-aaaaaaaaaaaaaaaaaaaaa']),
    })
    expect(orphaned).toEqual([])

    const orphaned2 = countOrphanedTerminalSessionIds({
      repoRoot: '/repo',
      repoInstanceId: 'repo-instance-test',
      localTerminalSessionIds: ['term-aaaaaaaaaaaaaaaaaaaaa', 'term-bbbbbbbbbbbbbbbbbbbbb', 'term-ccccccccccccccccccccc'],
      getRepoRootForTerminalSessionId: (terminalSessionId) => (terminalSessionId === 'term-ccccccccccccccccccccc' ? '/other' : '/repo'),
      getRepoInstanceIdForTerminalSessionId: () => 'repo-instance-test',
      hasTerminalRuntimeSessionIdForTerminalSessionId: (terminalSessionId) => terminalSessionId === 'term-bbbbbbbbbbbbbbbbbbbbb',
      serverTerminalSessionIds: new Set(['term-aaaaaaaaaaaaaaaaaaaaa']),
    })
    expect(orphaned2).toEqual(['term-bbbbbbbbbbbbbbbbbbbbb'])
  })

  test('selects the adjacent tab after removing the active terminal', () => {
    expect(resolveAdjacentTerminalSelectionAfterRemoval(['term-aaaaaaaaaaaaaaaaaaaaa', 'term-bbbbbbbbbbbbbbbbbbbbb', 'term-ccccccccccccccccccccc'], 'term-bbbbbbbbbbbbbbbbbbbbb')).toBe(
      'term-ccccccccccccccccccccc',
    )
    expect(resolveAdjacentTerminalSelectionAfterRemoval(['term-aaaaaaaaaaaaaaaaaaaaa', 'term-bbbbbbbbbbbbbbbbbbbbb'], 'term-bbbbbbbbbbbbbbbbbbbbb')).toBe('term-aaaaaaaaaaaaaaaaaaaaa')
    expect(resolveAdjacentTerminalSelectionAfterRemoval(['term-aaaaaaaaaaaaaaaaaaaaa'], 'term-aaaaaaaaaaaaaaaaaaaaa')).toBeNull()
  })
})
