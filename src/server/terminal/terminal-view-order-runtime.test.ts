import { describe, expect, test } from 'vitest'
import { createTerminalViewOrderRuntime } from '#/server/terminal/terminal-view-order-runtime.ts'

describe('terminal view order runtime', () => {
  test('tracks terminal display order within an owner worktree', () => {
    const runtime = createTerminalViewOrderRuntime<string>()

    runtime.registerTerminalView({ userId: 'owner-a', scope: '/repo', worktreePath: '/repo-linked', id: 'slot-1' })
    runtime.registerTerminalView({ userId: 'owner-a', scope: '/repo', worktreePath: '/repo-linked', id: 'slot-2' })

    expect(runtime.viewDisplayOrder(view('slot-1'))).toBe(0)
    expect(runtime.viewDisplayOrder(view('slot-2'))).toBe(1)
  })

  test('isolates identical terminal identities by owner', () => {
    const runtime = createTerminalViewOrderRuntime<string>()

    runtime.registerTerminalView({ userId: 'owner-a', scope: '/repo', worktreePath: '/repo-linked', id: 'slot-1' })
    runtime.registerTerminalView({ userId: 'owner-b', scope: '/repo', worktreePath: '/repo-linked', id: 'slot-1' })

    expect(runtime.viewDisplayOrder(view('slot-1'))).toBe(0)
    expect(runtime.viewDisplayOrder({ ...view('slot-1'), userId: 'owner-b' })).toBe(0)
  })

  test('removes terminal views by owner', () => {
    const runtime = createTerminalViewOrderRuntime<string>()

    runtime.registerTerminalView({ userId: 'owner-a', scope: '/repo', worktreePath: '/repo-linked', id: 'slot-1' })
    runtime.registerTerminalView({ userId: 'owner-b', scope: '/repo', worktreePath: '/repo-linked', id: 'slot-1' })

    runtime.closeViewsForOwner('owner-a')

    expect(runtime.viewDisplayOrder(view('slot-1'))).toBeNull()
    expect(runtime.viewDisplayOrder({ ...view('slot-1'), userId: 'owner-b' })).toBe(0)
  })
})

function view(id: string): {
  userId: string
  scope: string
  worktreePath: string
  id: string
} {
  return {
    userId: 'owner-a',
    scope: '/repo',
    worktreePath: '/repo-linked',
    id,
  }
}
