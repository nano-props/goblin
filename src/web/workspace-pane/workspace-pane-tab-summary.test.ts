import { describe, expect, test } from 'vitest'
import {
  type WorkspacePaneGenericRuntimeTabSummary,
  workspacePanePendingRuntimeTabIdentity,
  workspacePaneRuntimeTabSummaryIdentity,
  workspacePaneRuntimeTabSummarySessionId,
} from '#/web/workspace-pane/workspace-pane-tab-summary.ts'
import type { WorkspacePaneTabSummary } from '#/web/workspace-pane/workspace-pane-tab-summary.ts'

const terminalView: WorkspacePaneTabSummary = {
  type: 'terminal',
  terminalSessionId: 'session-1',
  terminalWorktreeKey: 'repo\0worktree',
  index: 1,
  title: 'terminal 1',
  phase: 'open',
  selected: true,
  hasBell: false,
  hasRecentOutput: false,
}

describe('workspace pane tab model', () => {
  test('keeps pending runtime tab identities stable', () => {
    expect(workspacePanePendingRuntimeTabIdentity('terminal')).toBe('terminal:pending')
  })

  test('derives runtime summary identities from the runtime session id', () => {
    expect(workspacePaneRuntimeTabSummarySessionId(terminalView)).toBe('session-1')
    expect(workspacePaneRuntimeTabSummaryIdentity(terminalView)).toBe('terminal:session-1')
    const genericView: WorkspacePaneGenericRuntimeTabSummary<'terminal'> = {
      type: 'terminal',
      runtimeSessionId: 'session-2',
    }
    expect(workspacePaneRuntimeTabSummarySessionId(genericView)).toBe('session-2')
    expect(workspacePaneRuntimeTabSummaryIdentity(genericView)).toBe('terminal:session-2')
  })
})
