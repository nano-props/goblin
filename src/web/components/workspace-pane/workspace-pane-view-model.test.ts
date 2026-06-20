import { describe, expect, test } from 'vitest'
import {
  adjacentWorkspacePaneView,
  nextWorkspacePaneViewAfterClose,
} from '#/web/components/workspace-pane/workspace-pane-view-model.ts'
import type { WorkspacePaneViewSummary } from '#/web/components/terminal/types.ts'

const tabs: WorkspacePaneViewSummary[] = [
  {
    type: 'terminal',
    id: 'terminal-1',
    key: 'terminal-1',
    worktreeTerminalKey: 'repo\0worktree',
    terminalId: 'terminal-1',
    index: 1,
    displayOrder: 1,
    title: 'terminal 1',
    phase: 'open',
    selected: true,
    hasBell: false,
  },
  {
    type: 'changes',
    id: 'changes',
    key: 'changes',
    worktreeTerminalKey: 'repo\0worktree',
    worktreePath: 'worktree',
    displayOrder: 2,
  },
]

describe('adjacentWorkspacePaneView', () => {
  test('moves through the actual workspace pane view order', () => {
    expect(adjacentWorkspacePaneView(tabs, 'status', 1)?.type).toBe('terminal')
    expect(adjacentWorkspacePaneView(tabs, 'terminal', 1)?.type).toBe('changes')
    expect(adjacentWorkspacePaneView(tabs, 'changes', 1)?.type).toBe('terminal')
  })

  test('uses the selected terminal as the active terminal view', () => {
    expect(adjacentWorkspacePaneView(tabs, 'terminal', -1)?.type).toBe('changes')
  })
})

describe('nextWorkspacePaneViewAfterClose', () => {
  test('prefers the next tab and falls back to the previous tab', () => {
    expect(nextWorkspacePaneViewAfterClose(tabs, 'terminal:terminal-1')?.type).toBe('changes')
    expect(nextWorkspacePaneViewAfterClose(tabs, 'changes:changes')?.type).toBe('terminal')
  })
})
