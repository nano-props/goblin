import { describe, expect, test, vi } from 'vitest'
import type { WorkspacePaneTerminalTabSummary } from '#/web/workspace-pane/workspace-pane-tab-summary.ts'
import {
  reselectWorkspacePaneRuntimeTab,
  selectWorkspacePaneRuntimeTab,
} from '#/web/workspace-pane/workspace-pane-runtime-tab-actions.ts'

const terminalView: WorkspacePaneTerminalTabSummary = {
  type: 'terminal',
  terminalSessionId: 'term-111111111111111111111',
  terminalWorktreeKey: 'repo\0worktree',
  index: 1,
  title: 'Terminal 1',
  fullTitle: 'Terminal 1',
  originalTitle: null,
  phase: 'open',
  selected: true,
  hasBell: false,
  hasRecentOutput: false,
}

describe('workspace pane runtime tab actions', () => {
  test('selects a terminal runtime tab through the runtime action registry', () => {
    const showRuntimeTab = vi.fn(() => true)

    expect(
      selectWorkspacePaneRuntimeTab(terminalView, {
        showRuntimeTab,
      }),
    ).toBe(true)

    expect(showRuntimeTab).toHaveBeenCalledWith('terminal', 'term-111111111111111111111')
  })

  test('reselects a terminal runtime tab through the runtime action registry', () => {
    const showRuntimeTab = vi.fn(() => true)
    const scrollToBottom = vi.fn()

    expect(
      reselectWorkspacePaneRuntimeTab(terminalView, {
        showRuntimeTab,
        terminal: { scrollToBottom },
      }),
    ).toBe(true)

    expect(showRuntimeTab).toHaveBeenCalledWith('terminal', 'term-111111111111111111111')
    expect(scrollToBottom).toHaveBeenCalledWith('term-111111111111111111111')
  })
})
