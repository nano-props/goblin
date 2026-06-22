import { describe, expect, test } from 'vitest'
import type { WorkspacePaneView } from '#/shared/workspace-pane.ts'
import {
  isBranchLevelWorkspacePaneView,
  isWorktreeLevelWorkspacePaneView,
  resolveWorkspacePaneSelectionView,
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

describe('resolveWorkspacePaneSelectionView', () => {
  test('preserves a non-terminal preference verbatim', () => {
    expect(resolveWorkspacePaneSelectionView('status', ctx())).toBe('status')
    expect(resolveWorkspacePaneSelectionView('history', ctx())).toBe('history')
    expect(resolveWorkspacePaneSelectionView('changes', ctx())).toBe('changes')
  })

  test('keeps a changes preference even when the worktree is clean', () => {
    expect(resolveWorkspacePaneSelectionView('changes', ctx())).toBe('changes')
    expect(resolveWorkspacePaneSelectionView('changes', ctx({ terminalSessionCount: 7 }))).toBe('changes')
  })

  test('returns null for worktree-scoped preferences when no worktree exists', () => {
    expect(resolveWorkspacePaneSelectionView('changes', ctx({ hasWorktree: false }))).toBeNull()
    expect(resolveWorkspacePaneSelectionView('terminal', ctx({ hasWorktree: false }))).toBeNull()
    expect(
      resolveWorkspacePaneSelectionView('terminal', ctx({ hasWorktree: false, terminalSessionCount: 5 })),
    ).toBeNull()
    expect(resolveWorkspacePaneSelectionView('history', ctx({ hasWorktree: false }))).toBe('history')
  })

  test('preserves the terminal preference while sync is unresolved', () => {
    expect(resolveWorkspacePaneSelectionView('terminal', ctx({ terminalSyncReady: false }))).toBe('terminal')
  })

  test('keeps the terminal preference when the active worktree has at least one session', () => {
    expect(resolveWorkspacePaneSelectionView('terminal', ctx({ terminalSessionCount: 1 }))).toBe('terminal')
    expect(resolveWorkspacePaneSelectionView('terminal', ctx({ terminalSessionCount: 7 }))).toBe('terminal')
  })

  test('returns null for terminal after sync confirms the worktree has no terminal sessions', () => {
    expect(resolveWorkspacePaneSelectionView('terminal', ctx({ terminalSessionCount: 0 }))).toBeNull()
  })

  test('does not dismiss terminal when sync settled with non-zero sessions', () => {
    expect(resolveWorkspacePaneSelectionView('terminal', ctx({ terminalSessionCount: 1 }))).toBe('terminal')
  })

  test('is total over the inputs', () => {
    const cases: Array<[WorkspacePaneView, WorkspacePaneViewContext, WorkspacePaneView | null]> = [
      ['status', ctx(), 'status'],
      ['status', ctx({ hasWorktree: false, terminalSyncReady: false }), 'status'],
      ['history', ctx(), 'history'],
      ['history', ctx({ hasWorktree: false }), 'history'],
      ['changes', ctx(), 'changes'],
      ['changes', ctx({ hasWorktree: false }), null],
      ['terminal', ctx({ hasWorktree: false }), null],
      ['terminal', ctx({ terminalSyncReady: false }), 'terminal'],
      ['terminal', ctx({ terminalSessionCount: 0 }), null],
      ['terminal', ctx({ terminalSessionCount: 3 }), 'terminal'],
    ]
    for (const [preferred, context, expected] of cases) {
      expect(resolveWorkspacePaneSelectionView(preferred, context)).toBe(expected)
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
