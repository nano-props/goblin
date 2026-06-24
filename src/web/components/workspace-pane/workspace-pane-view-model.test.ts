import { describe, expect, test } from 'vitest'
import {
  isTerminalWorkspacePaneView,
  staticWorkspacePaneViewIdentity,
  terminalWorkspacePaneViewIdentity,
  workspacePaneViewButtonId,
  workspacePaneViewIdentity,
} from '#/web/components/workspace-pane/workspace-pane-view-model.ts'
import type { WorkspacePaneViewSummary } from '#/web/components/terminal/types.ts'

const terminalView: WorkspacePaneViewSummary = {
  type: 'terminal',
  id: 'slot-1',
  key: 'slot-1',
  worktreeTerminalKey: 'repo\0worktree',
  slotId: 'slot-1',
  index: 1,
  displayOrder: 1,
  title: 'terminal 1',
  phase: 'open',
  selected: true,
  hasBell: false,
}

describe('workspace pane view model', () => {
  test('builds stable identities for runtime and static workspace pane views', () => {
    expect(workspacePaneViewIdentity(terminalView)).toBe('terminal:slot-1')
    expect(terminalWorkspacePaneViewIdentity('slot-1')).toBe('terminal:slot-1')
    expect(staticWorkspacePaneViewIdentity('status')).toBe('status:status')
    expect(staticWorkspacePaneViewIdentity('changes')).toBe('changes:changes')
  })

  test('builds button ids for the view strip', () => {
    expect(workspacePaneViewButtonId('workspace-pane', 0)).toBe('workspace-pane-workspace-pane-view')
    expect(workspacePaneViewButtonId('workspace-pane', 2)).toBe('workspace-pane-workspace-pane-view-2')
  })

  test('narrows terminal workspace pane views', () => {
    expect(isTerminalWorkspacePaneView(terminalView)).toBe(true)
  })
})
