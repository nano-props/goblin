import { describe, expect, test } from 'vitest'
import { createTerminalViewOrderRuntime } from '#/server/terminal/terminal-view-order-runtime.ts'

describe('terminal view order runtime', () => {
  test('tracks terminal display order within a user worktree', () => {
    const runtime = createTerminalViewOrderRuntime<string>()

    runtime.registerTerminalView({ userId: 'user-a', scope: '/repo', worktreePath: '/repo-linked', id: 'slot-1' })
    runtime.registerTerminalView({ userId: 'user-a', scope: '/repo', worktreePath: '/repo-linked', id: 'slot-2' })

    expect(runtime.viewDisplayOrder(view('slot-1'))).toBe(0)
    expect(runtime.viewDisplayOrder(view('slot-2'))).toBe(1)
  })

  test('isolates identical terminal identities by user', () => {
    const runtime = createTerminalViewOrderRuntime<string>()

    runtime.registerTerminalView({ userId: 'user-a', scope: '/repo', worktreePath: '/repo-linked', id: 'slot-1' })
    runtime.registerTerminalView({ userId: 'user-b', scope: '/repo', worktreePath: '/repo-linked', id: 'slot-1' })

    expect(runtime.viewDisplayOrder(view('slot-1'))).toBe(0)
    expect(runtime.viewDisplayOrder({ ...view('slot-1'), userId: 'user-b' })).toBe(0)
  })

  test('removes terminal views by user', () => {
    const runtime = createTerminalViewOrderRuntime<string>()

    runtime.registerTerminalView({ userId: 'user-a', scope: '/repo', worktreePath: '/repo-linked', id: 'slot-1' })
    runtime.registerTerminalView({ userId: 'user-b', scope: '/repo', worktreePath: '/repo-linked', id: 'slot-1' })

    runtime.closeViewsForUser('user-a')

    expect(runtime.viewDisplayOrder(view('slot-1'))).toBeNull()
    expect(runtime.viewDisplayOrder({ ...view('slot-1'), userId: 'user-b' })).toBe(0)
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
