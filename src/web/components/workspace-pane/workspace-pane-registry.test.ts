// @vitest-environment jsdom

import { describe, expect, test } from 'vitest'
import { RendererWorkspacePaneRegistry } from '#/web/components/workspace-pane/workspace-pane-registry.ts'

const REPO_ROOT = '/repo'
const WORKTREE_PATH = '/repo-linked'
const WORKTREE_KEY = `${REPO_ROOT}\0${WORKTREE_PATH}`

describe('RendererWorkspacePaneRegistry', () => {
  test('reconciles worktree-level server static views by worktree and reports changed keys', () => {
    const registry = new RendererWorkspacePaneRegistry()

    const changed = registry.reconcileServerStaticViews(REPO_ROOT, [
      { type: 'changes', id: 'changes', worktreePath: WORKTREE_PATH, displayOrder: 2 },
      { type: 'status', id: 'status', worktreePath: WORKTREE_PATH, displayOrder: 1 } as never,
    ])

    expect(changed).toEqual([WORKTREE_KEY])
    expect(registry.staticViews(WORKTREE_KEY).map((tab) => tab.type)).toEqual(['changes'])
  })

  test('validates and applies optimistic mixed reorder state', () => {
    const registry = new RendererWorkspacePaneRegistry()
    const displayOrderByKey = new Map<string, number>([['terminal-1', 0]])
    registry.reconcileServerStaticViews(REPO_ROOT, [
      { type: 'changes', id: 'changes', worktreePath: WORKTREE_PATH, displayOrder: 1 },
    ])

    expect(
      registry.validateReorder({
        worktreeKey: WORKTREE_KEY,
        existingTerminalKeys: ['terminal-1'],
        orderedViews: [
          { type: 'changes', id: 'changes' },
          { type: 'terminal', id: 'terminal-1' },
        ],
      }),
    ).toBe(true)

    registry.applyOptimisticWorkspacePaneViewOrder(
      WORKTREE_KEY,
      [
        { type: 'changes', id: 'changes' },
        { type: 'terminal', id: 'terminal-1' },
      ],
      displayOrderByKey,
    )

    expect(registry.staticViews(WORKTREE_KEY)[0]?.displayOrder).toBe(0)
    expect(displayOrderByKey.get('terminal-1')).toBe(1)
  })
})
