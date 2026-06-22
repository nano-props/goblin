import { describe, expect, test } from 'vitest'
import {
  isTerminalWorkspacePaneView,
  staticWorkspacePaneViewIdentity,
  terminalWorkspacePaneViewIdentity,
  workspacePaneViewButtonId,
  workspacePaneViewIdentity,
  workspacePaneViewOrderEntry,
} from '#/web/components/workspace-pane/workspace-pane-view-model.ts'
import type { WorkspacePaneViewSummary } from '#/web/components/terminal/types.ts'

const terminalView: WorkspacePaneViewSummary = {
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
}

const changesView: WorkspacePaneViewSummary = {
  type: 'changes',
  id: 'changes',
  key: 'changes',
  worktreeTerminalKey: 'repo\0worktree',
  worktreePath: 'worktree',
  displayOrder: 2,
}

describe('workspace pane view model', () => {
  test('builds stable identities for runtime and static workspace pane views', () => {
    expect(workspacePaneViewIdentity(terminalView)).toBe('terminal:terminal-1')
    expect(terminalWorkspacePaneViewIdentity('terminal-1')).toBe('terminal:terminal-1')
    expect(staticWorkspacePaneViewIdentity('status')).toBe('status:status')
    expect(staticWorkspacePaneViewIdentity('changes')).toBe('changes:changes')
  })

  test('builds order entries and button ids for the view strip', () => {
    expect(workspacePaneViewOrderEntry(changesView)).toEqual({ type: 'changes', id: 'changes' })
    expect(workspacePaneViewButtonId('workspace-pane', 0)).toBe('workspace-pane-workspace-pane-view')
    expect(workspacePaneViewButtonId('workspace-pane', 2)).toBe('workspace-pane-workspace-pane-view-2')
  })

  test('narrows terminal workspace pane views', () => {
    expect(isTerminalWorkspacePaneView(terminalView)).toBe(true)
    expect(isTerminalWorkspacePaneView(changesView)).toBe(false)
  })
})
