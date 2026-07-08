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
      localTerminalSessionIds: ['session-a', 'session-b', 'session-c'],
      getRepoRootForTerminalSessionId: (terminalSessionId) => (terminalSessionId === 'session-c' ? '/other' : '/repo'),
      getRepoInstanceIdForTerminalSessionId: () => 'repo-instance-test',
      hasTerminalRuntimeSessionIdForTerminalSessionId: (terminalSessionId) => terminalSessionId !== 'session-b',
      serverTerminalSessionIds: new Set(['session-a']),
    })
    expect(orphaned).toEqual([])

    const orphaned2 = countOrphanedTerminalSessionIds({
      repoRoot: '/repo',
      repoInstanceId: 'repo-instance-test',
      localTerminalSessionIds: ['session-a', 'session-b', 'session-c'],
      getRepoRootForTerminalSessionId: (terminalSessionId) => (terminalSessionId === 'session-c' ? '/other' : '/repo'),
      getRepoInstanceIdForTerminalSessionId: () => 'repo-instance-test',
      hasTerminalRuntimeSessionIdForTerminalSessionId: (terminalSessionId) => terminalSessionId === 'session-b',
      serverTerminalSessionIds: new Set(['session-a']),
    })
    expect(orphaned2).toEqual(['session-b'])
  })

  test('selects the adjacent tab after removing the active terminal', () => {
    expect(resolveAdjacentTerminalSelectionAfterRemoval(['session-a', 'session-b', 'session-c'], 'session-b')).toBe(
      'session-c',
    )
    expect(resolveAdjacentTerminalSelectionAfterRemoval(['session-a', 'session-b'], 'session-b')).toBe('session-a')
    expect(resolveAdjacentTerminalSelectionAfterRemoval(['session-a'], 'session-a')).toBeNull()
  })
})
