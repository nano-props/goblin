import { describe, expect, test } from 'vitest'
import { createTerminalViewOrderRuntime } from '#/server/terminal/terminal-view-order-runtime.ts'

describe('terminal view order runtime', () => {
  test('tracks terminal display order within an owner worktree', () => {
    const runtime = createTerminalViewOrderRuntime<string>()

    runtime.registerTerminalView({ ownerId: 'owner-a', scope: '/repo', worktreePath: '/repo-linked', id: 'terminal-1' })
    runtime.registerTerminalView({ ownerId: 'owner-a', scope: '/repo', worktreePath: '/repo-linked', id: 'terminal-2' })

    expect(runtime.viewDisplayOrder(view('terminal-1'))).toBe(0)
    expect(runtime.viewDisplayOrder(view('terminal-2'))).toBe(1)
  })

  test('isolates identical terminal identities by owner', () => {
    const runtime = createTerminalViewOrderRuntime<string>()

    runtime.registerTerminalView({ ownerId: 'owner-a', scope: '/repo', worktreePath: '/repo-linked', id: 'terminal-1' })
    runtime.registerTerminalView({ ownerId: 'owner-b', scope: '/repo', worktreePath: '/repo-linked', id: 'terminal-1' })

    expect(runtime.viewDisplayOrder(view('terminal-1'))).toBe(0)
    expect(runtime.viewDisplayOrder({ ...view('terminal-1'), ownerId: 'owner-b' })).toBe(0)
  })

  test('removes terminal views by owner', () => {
    const runtime = createTerminalViewOrderRuntime<string>()

    runtime.registerTerminalView({ ownerId: 'owner-a', scope: '/repo', worktreePath: '/repo-linked', id: 'terminal-1' })
    runtime.registerTerminalView({ ownerId: 'owner-b', scope: '/repo', worktreePath: '/repo-linked', id: 'terminal-1' })

    runtime.closeViewsForOwner('owner-a')

    expect(runtime.viewDisplayOrder(view('terminal-1'))).toBeNull()
    expect(runtime.viewDisplayOrder({ ...view('terminal-1'), ownerId: 'owner-b' })).toBe(0)
  })
})

function view(id: string): {
  ownerId: string
  scope: string
  worktreePath: string
  id: string
} {
  return {
    ownerId: 'owner-a',
    scope: '/repo',
    worktreePath: '/repo-linked',
    id,
  }
}
