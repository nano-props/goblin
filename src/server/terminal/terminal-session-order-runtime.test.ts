import { describe, expect, test } from 'vitest'
import { createTerminalSessionOrderRuntime } from '#/server/terminal/terminal-session-order-runtime.ts'

describe('terminal session order runtime', () => {
  test('replaces terminal order within a user worktree', () => {
    const runtime = createTerminalSessionOrderRuntime<string>()

    runtime.replaceTerminalSessionOrder({
      userId: 'user-a',
      scope: '/repo',
      worktreePath: '/repo-linked',
      terminalSessionIds: ['session-1', 'session-2'],
    })

    expect(runtime.orderedTerminalSessionIds(worktree())).toEqual(['session-1', 'session-2'])

    runtime.replaceTerminalSessionOrder({
      userId: 'user-a',
      scope: '/repo',
      worktreePath: '/repo-linked',
      terminalSessionIds: ['session-2', 'session-1'],
    })

    expect(runtime.orderedTerminalSessionIds(worktree())).toEqual(['session-2', 'session-1'])
  })

  test('isolates identical terminal identities by user', () => {
    const runtime = createTerminalSessionOrderRuntime<string>()

    runtime.replaceTerminalSessionOrder({
      userId: 'user-a',
      scope: '/repo',
      worktreePath: '/repo-linked',
      terminalSessionIds: ['session-1'],
    })
    runtime.replaceTerminalSessionOrder({
      userId: 'user-b',
      scope: '/repo',
      worktreePath: '/repo-linked',
      terminalSessionIds: ['session-1'],
    })

    expect(runtime.orderedTerminalSessionIds(worktree())).toEqual(['session-1'])
    expect(runtime.orderedTerminalSessionIds({ ...worktree(), userId: 'user-b' })).toEqual(['session-1'])
  })

  test('removes terminal views by user', () => {
    const runtime = createTerminalSessionOrderRuntime<string>()

    runtime.replaceTerminalSessionOrder({
      userId: 'user-a',
      scope: '/repo',
      worktreePath: '/repo-linked',
      terminalSessionIds: ['session-1'],
    })
    runtime.replaceTerminalSessionOrder({
      userId: 'user-b',
      scope: '/repo',
      worktreePath: '/repo-linked',
      terminalSessionIds: ['session-1'],
    })

    runtime.closeSessionsForUser('user-a')

    expect(runtime.orderedTerminalSessionIds(worktree())).toEqual([])
    expect(runtime.orderedTerminalSessionIds({ ...worktree(), userId: 'user-b' })).toEqual(['session-1'])
  })
})

function worktree(): {
  userId: string
  scope: string
  worktreePath: string
} {
  return {
    userId: 'user-a',
    scope: '/repo',
    worktreePath: '/repo-linked',
  }
}
