import { describe, expect, test } from 'vitest'
import {
  PENDING_TERMINAL_WORKSPACE_PANE_VIEW_IDENTITY,
  isTerminalWorkspacePaneView,
} from '#/web/components/workspace-pane/workspace-pane-tab-summary.ts'
import type { WorkspacePaneTabSummary } from '#/web/components/terminal/types.ts'

const terminalView: WorkspacePaneTabSummary = {
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
  test('keeps the pending terminal identity stable', () => {
    expect(PENDING_TERMINAL_WORKSPACE_PANE_VIEW_IDENTITY).toBe('terminal:pending')
  })

  test('narrows terminal workspace pane views', () => {
    expect(isTerminalWorkspacePaneView(terminalView)).toBe(true)
  })
})
