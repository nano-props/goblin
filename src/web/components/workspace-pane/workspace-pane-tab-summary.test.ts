import { describe, expect, test } from 'vitest'
import {
  PENDING_TERMINAL_WORKSPACE_PANE_TAB_IDENTITY,
  isTerminalWorkspacePaneTab,
} from '#/web/components/workspace-pane/workspace-pane-tab-summary.ts'
import type { WorkspacePaneTabSummary } from '#/web/components/terminal/types.ts'

const terminalView: WorkspacePaneTabSummary = {
  type: 'terminal',
  id: 'session-1',
  key: 'session-1',
  worktreeTerminalKey: 'repo\0worktree',
  sessionId: 'session-1',
  index: 1,
  displayOrder: 1,
  title: 'terminal 1',
  phase: 'open',
  selected: true,
  hasBell: false,
}

describe('workspace pane tab model', () => {
  test('keeps the pending terminal identity stable', () => {
    expect(PENDING_TERMINAL_WORKSPACE_PANE_TAB_IDENTITY).toBe('terminal:pending')
  })

  test('narrows terminal workspace pane tabs', () => {
    expect(isTerminalWorkspacePaneTab(terminalView)).toBe(true)
  })
})
