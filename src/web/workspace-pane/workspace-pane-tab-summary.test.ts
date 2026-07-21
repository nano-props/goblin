import { describe, expect, test } from 'vitest'
import {
  workspacePanePendingRuntimeTabIdentity,
  workspacePaneRuntimeTabSummaryIdentity,
  workspacePaneRuntimeTabSummarySessionId,
} from '#/web/workspace-pane/workspace-pane-tab-summary.ts'
import type { WorkspacePaneTabSummary } from '#/web/workspace-pane/workspace-pane-tab-summary.ts'

const terminalView: WorkspacePaneTabSummary = {
  type: 'terminal',
  terminalSessionId: 'term-111111111111111111111',
  terminalFilesystemTargetKey: 'repo\0worktree',
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
    expect(workspacePaneRuntimeTabSummarySessionId(terminalView)).toBe('term-111111111111111111111')
    expect(workspacePaneRuntimeTabSummaryIdentity(terminalView)).toBe('terminal:term-111111111111111111111')
  })
})
