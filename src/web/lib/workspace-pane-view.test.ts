import { describe, expect, test } from 'vitest'
import type { WorkspacePaneView } from '#/shared/workspace-pane.ts'
import {
  computeEffectiveWorkspacePaneView,
  isBranchLevelWorkspacePaneView,
  isWorktreeLevelWorkspacePaneView,
  workspacePaneViewScope,
  type WorkspacePaneViewContext,
} from '#/web/lib/workspace-pane-view.ts'

function ctx(overrides: Partial<WorkspacePaneViewContext> = {}): WorkspacePaneViewContext {
  return {
    hasWorktree: true,
    terminalSessionCount: 0,
    terminalSyncReady: true,
    ...overrides,
  }
}

describe('computeEffectiveWorkspacePaneView', () => {
  test('preserves a non-terminal preference verbatim', () => {
    expect(computeEffectiveWorkspacePaneView('status', ctx())).toBe('status')
    expect(computeEffectiveWorkspacePaneView('history', ctx())).toBe('history')
    expect(computeEffectiveWorkspacePaneView('changes', ctx())).toBe('changes')
  })

  test('keeps a changes preference even when the worktree is clean', () => {
    expect(computeEffectiveWorkspacePaneView('changes', ctx())).toBe('changes')
    expect(computeEffectiveWorkspacePaneView('changes', ctx({ terminalSessionCount: 7 }))).toBe('changes')
  })

  test('falls back to status when no worktree exists', () => {
    expect(computeEffectiveWorkspacePaneView('changes', ctx({ hasWorktree: false }))).toBe('status')
    expect(computeEffectiveWorkspacePaneView('terminal', ctx({ hasWorktree: false }))).toBe('status')
    expect(computeEffectiveWorkspacePaneView('terminal', ctx({ hasWorktree: false, terminalSessionCount: 5 }))).toBe(
      'status',
    )
    expect(computeEffectiveWorkspacePaneView('history', ctx({ hasWorktree: false }))).toBe('history')
  })

  test('preserves the terminal preference when sync has not yet settled', () => {
    // syncReady=false means we don't yet know the session count; avoid
    // flashing status → terminal → status during boot.
    expect(computeEffectiveWorkspacePaneView('terminal', ctx({ terminalSyncReady: false }))).toBe('terminal')
  })

  test('keeps the terminal preference when the active worktree has at least one session', () => {
    expect(computeEffectiveWorkspacePaneView('terminal', ctx({ terminalSessionCount: 1 }))).toBe('terminal')
    expect(computeEffectiveWorkspacePaneView('terminal', ctx({ terminalSessionCount: 7 }))).toBe('terminal')
  })

  test('dismisses the terminal preference to status when sync has settled and the worktree is empty', () => {
    expect(computeEffectiveWorkspacePaneView('terminal', ctx({ terminalSessionCount: 0 }))).toBe('status')
  })

  test('keeps terminal renderable while a create request is pending', () => {
    expect(computeEffectiveWorkspacePaneView('terminal', ctx({ terminalPendingCreate: true }))).toBe('terminal')
  })

  test('does not dismiss terminal when sync settled with non-zero sessions', () => {
    expect(computeEffectiveWorkspacePaneView('terminal', ctx({ terminalSessionCount: 1 }))).toBe('terminal')
  })

  test('is total over the inputs', () => {
    const cases: Array<[WorkspacePaneView, WorkspacePaneViewContext, WorkspacePaneView]> = [
      ['status', ctx(), 'status'],
      ['status', ctx({ hasWorktree: false, terminalSyncReady: false }), 'status'],
      ['history', ctx(), 'history'],
      ['history', ctx({ hasWorktree: false }), 'history'],
      ['changes', ctx(), 'changes'],
      ['changes', ctx({ hasWorktree: false }), 'status'],
      ['terminal', ctx({ hasWorktree: false }), 'status'],
      ['terminal', ctx({ terminalSyncReady: false }), 'terminal'],
      ['terminal', ctx({ terminalSessionCount: 0 }), 'status'],
      ['terminal', ctx({ terminalPendingCreate: true }), 'terminal'],
      ['terminal', ctx({ terminalSessionCount: 3 }), 'terminal'],
    ]
    for (const [preferred, context, expected] of cases) {
      expect(computeEffectiveWorkspacePaneView(preferred, context)).toBe(expected)
    }
  })
})

describe('workspacePaneViewScope', () => {
  test('classifies status/history as branch-level and changes/terminal as worktree-level', () => {
    expect(workspacePaneViewScope('status')).toBe('branch')
    expect(isBranchLevelWorkspacePaneView('status')).toBe(true)
    expect(workspacePaneViewScope('history')).toBe('branch')
    expect(isBranchLevelWorkspacePaneView('history')).toBe(true)
    expect(workspacePaneViewScope('changes')).toBe('worktree')
    expect(workspacePaneViewScope('terminal')).toBe('worktree')
    expect(isWorktreeLevelWorkspacePaneView('changes')).toBe(true)
    expect(isWorktreeLevelWorkspacePaneView('terminal')).toBe(true)
  })
})
