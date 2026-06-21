import { describe, expect, test } from 'vitest'
import { createWorkspacePaneRuntime } from '#/server/workspace-pane/workspace-pane-runtime.ts'

describe('workspace pane runtime', () => {
  test('opens static views after registered terminal views in one worktree order', () => {
    const runtime = createWorkspacePaneRuntime<string>()

    runtime.registerTerminalView({
      ownerId: 'owner-a',
      scope: '/repo',
      worktreePath: '/repo-linked',
      id: 'terminal-key-1',
    })

    expect(runtime.openStaticView('owner-a', '/repo', '/repo-linked', 'changes')).toBe(true)

    expect(runtime.viewDisplayOrder(view('terminal', 'terminal-key-1'))).toBe(0)
    expect(runtime.listStaticViews('owner-a', '/repo')).toEqual([
      {
        type: 'changes',
        id: 'changes',
        worktreePath: '/repo-linked',
        displayOrder: 1,
      },
    ])
  })

  test('validates and applies mixed terminal/static reorder payloads', () => {
    const runtime = createWorkspacePaneRuntime<string>()
    runtime.registerTerminalView({ ownerId: 'owner-a', scope: '/repo', worktreePath: '/repo-linked', id: 'terminal-1' })
    runtime.registerTerminalView({ ownerId: 'owner-a', scope: '/repo', worktreePath: '/repo-linked', id: 'terminal-2' })
    runtime.openStaticView('owner-a', '/repo', '/repo-linked', 'status')
    runtime.openStaticView('owner-a', '/repo', '/repo-linked', 'changes')

    expect(
      runtime.reorderViews('owner-a', '/repo', '/repo-linked', [
        { type: 'status', id: 'status' },
        { type: 'changes', id: 'changes' },
        { type: 'terminal', id: 'terminal-2' },
        { type: 'terminal', id: 'terminal-1' },
      ]),
    ).toBe(true)

    expect(runtime.listStaticViews('owner-a', '/repo')).toEqual([
      {
        type: 'status',
        id: 'status',
        worktreePath: '/repo-linked',
        displayOrder: 0,
      },
      {
        type: 'changes',
        id: 'changes',
        worktreePath: '/repo-linked',
        displayOrder: 1,
      },
    ])
    expect(runtime.viewDisplayOrder(view('terminal', 'terminal-2'))).toBe(2)
    expect(runtime.viewDisplayOrder(view('terminal', 'terminal-1'))).toBe(3)
  })

  test('rejects duplicate, missing, and unopened views without changing order', () => {
    const runtime = createWorkspacePaneRuntime<string>()
    runtime.registerTerminalView({ ownerId: 'owner-a', scope: '/repo', worktreePath: '/repo-linked', id: 'terminal-1' })
    runtime.registerTerminalView({ ownerId: 'owner-a', scope: '/repo', worktreePath: '/repo-linked', id: 'terminal-2' })

    expect(
      runtime.reorderViews('owner-a', '/repo', '/repo-linked', [
        { type: 'terminal', id: 'terminal-1' },
        { type: 'terminal', id: 'terminal-1' },
      ]),
    ).toBe(false)
    expect(
      runtime.reorderViews('owner-a', '/repo', '/repo-linked', [
        { type: 'terminal', id: 'terminal-2' },
        { type: 'status', id: 'status' },
      ]),
    ).toBe(false)

    expect(runtime.viewDisplayOrder(view('terminal', 'terminal-1'))).toBe(0)
    expect(runtime.viewDisplayOrder(view('terminal', 'terminal-2'))).toBe(1)
    expect(runtime.listStaticViews('owner-a', '/repo')).toEqual([])
  })

  test('isolates identical view identities by owner', () => {
    const runtime = createWorkspacePaneRuntime<string>()
    runtime.registerTerminalView({ ownerId: 'owner-a', scope: '/repo', worktreePath: '/repo-linked', id: 'terminal-1' })
    runtime.registerTerminalView({ ownerId: 'owner-b', scope: '/repo', worktreePath: '/repo-linked', id: 'terminal-1' })
    runtime.openStaticView('owner-b', '/repo', '/repo-linked', 'changes')

    expect(
      runtime.reorderViews('owner-a', '/repo', '/repo-linked', [
        { type: 'changes', id: 'changes' },
        { type: 'terminal', id: 'terminal-1' },
      ]),
    ).toBe(false)
    expect(runtime.listStaticViews('owner-a', '/repo')).toEqual([])
    expect(runtime.listStaticViews('owner-b', '/repo')).toHaveLength(1)
  })

  test('prunes only static views for removed local worktrees', () => {
    const runtime = createWorkspacePaneRuntime<string>()
    runtime.registerTerminalView({
      ownerId: 'owner-a',
      scope: '/repo',
      worktreePath: '/repo-removed',
      id: 'terminal-1',
    })
    runtime.openStaticView('owner-a', '/repo', '/repo-live', 'changes')
    runtime.openStaticView('owner-a', '/repo', '/repo-removed', 'changes')
    runtime.openStaticView('owner-b', '/repo', '/repo-removed', 'changes')

    const pruned = runtime.pruneStaticViewsForOwner('owner-a', '/repo', new Set(['/repo-live']))

    expect(pruned).toBe(1)
    expect(runtime.listStaticViews('owner-a', '/repo')).toEqual([
      { type: 'changes', id: 'changes', worktreePath: '/repo-live', displayOrder: 0 },
    ])
    expect(runtime.viewDisplayOrder(view('terminal', 'terminal-1', '/repo-removed'))).toBe(0)
    expect(runtime.listStaticViews('owner-b', '/repo')).toEqual([
      { type: 'changes', id: 'changes', worktreePath: '/repo-removed', displayOrder: 0 },
    ])
  })
})

function view(
  type: 'terminal',
  id: string,
  worktreePath = '/repo-linked',
): {
  ownerId: string
  scope: string
  worktreePath: string
  type: 'terminal'
  id: string
} {
  return {
    ownerId: 'owner-a',
    scope: '/repo',
    worktreePath,
    type,
    id,
  }
}
