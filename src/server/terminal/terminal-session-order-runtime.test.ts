import { describe, expect, test } from 'vitest'
import { createTerminalSessionOrderRuntime } from '#/server/terminal/terminal-session-order-runtime.ts'

describe('terminal session order runtime', () => {
  test('tracks terminal display order within a user worktree', () => {
    const runtime = createTerminalSessionOrderRuntime<string>()

    runtime.registerTerminalSessionOrder({
      userId: 'user-a',
      scope: '/repo',
      worktreePath: '/repo-linked',
      id: 'session-1',
    })
    runtime.registerTerminalSessionOrder({
      userId: 'user-a',
      scope: '/repo',
      worktreePath: '/repo-linked',
      id: 'session-2',
    })

    expect(runtime.sessionDisplayOrder(view('session-1'))).toBe(0)
    expect(runtime.sessionDisplayOrder(view('session-2'))).toBe(1)
  })

  test('isolates identical terminal identities by user', () => {
    const runtime = createTerminalSessionOrderRuntime<string>()

    runtime.registerTerminalSessionOrder({
      userId: 'user-a',
      scope: '/repo',
      worktreePath: '/repo-linked',
      id: 'session-1',
    })
    runtime.registerTerminalSessionOrder({
      userId: 'user-b',
      scope: '/repo',
      worktreePath: '/repo-linked',
      id: 'session-1',
    })

    expect(runtime.sessionDisplayOrder(view('session-1'))).toBe(0)
    expect(runtime.sessionDisplayOrder({ ...view('session-1'), userId: 'user-b' })).toBe(0)
  })

  test('removes terminal views by user', () => {
    const runtime = createTerminalSessionOrderRuntime<string>()

    runtime.registerTerminalSessionOrder({
      userId: 'user-a',
      scope: '/repo',
      worktreePath: '/repo-linked',
      id: 'session-1',
    })
    runtime.registerTerminalSessionOrder({
      userId: 'user-b',
      scope: '/repo',
      worktreePath: '/repo-linked',
      id: 'session-1',
    })

    runtime.closeSessionsForUser('user-a')

    expect(runtime.sessionDisplayOrder(view('session-1'))).toBeNull()
    expect(runtime.sessionDisplayOrder({ ...view('session-1'), userId: 'user-b' })).toBe(0)
  })
})

function view(id: string): {
  userId: string
  scope: string
  worktreePath: string
  id: string
} {
  return {
    userId: 'user-a',
    scope: '/repo',
    worktreePath: '/repo-linked',
    id,
  }
}
