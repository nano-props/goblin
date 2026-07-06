import { describe, expect, test } from 'vitest'
import type { WorkspacePaneTabType } from '#/shared/workspace-pane.ts'
import {
  isBranchLevelWorkspacePaneTab,
  isWorktreeLevelWorkspacePaneTab,
  resolveRenderableWorkspacePaneTab,
  workspacePaneTabScope,
  type WorkspacePaneRenderabilityContext,
} from '#/web/lib/workspace-pane-tab.ts'

function ctx(overrides: Partial<WorkspacePaneRenderabilityContext> = {}): WorkspacePaneRenderabilityContext {
  return {
    hasWorktree: true,
    terminalSessionCount: 0,
    terminalProjectionPhase: 'ready',
    ...overrides,
  }
}

describe('resolveRenderableWorkspacePaneTab', () => {
  test('preserves a non-terminal preference verbatim', () => {
    expect(resolveRenderableWorkspacePaneTab('status', ctx())).toBe('status')
    expect(resolveRenderableWorkspacePaneTab('history', ctx())).toBe('history')
    expect(resolveRenderableWorkspacePaneTab('changes', ctx())).toBe('changes')
  })

  test('keeps a changes preference even when the worktree is clean', () => {
    expect(resolveRenderableWorkspacePaneTab('changes', ctx())).toBe('changes')
    expect(resolveRenderableWorkspacePaneTab('changes', ctx({ terminalSessionCount: 7 }))).toBe('changes')
  })

  test('returns null for worktree-scoped preferences when no worktree exists', () => {
    expect(resolveRenderableWorkspacePaneTab('changes', ctx({ hasWorktree: false }))).toBeNull()
    expect(resolveRenderableWorkspacePaneTab('terminal', ctx({ hasWorktree: false }))).toBeNull()
    expect(
      resolveRenderableWorkspacePaneTab('terminal', ctx({ hasWorktree: false, terminalSessionCount: 5 })),
    ).toBeNull()
    expect(resolveRenderableWorkspacePaneTab('history', ctx({ hasWorktree: false }))).toBe('history')
  })

  test('preserves the terminal preference while sync is unresolved', () => {
    expect(resolveRenderableWorkspacePaneTab('terminal', ctx({ terminalProjectionPhase: 'pending' }))).toBe('terminal')
  })

  test('preserves the terminal preference while terminal creation is pending', () => {
    expect(resolveRenderableWorkspacePaneTab('terminal', ctx({ terminalCreatePending: true }))).toBe('terminal')
  })

  test('keeps the terminal preference when the active worktree has at least one session', () => {
    expect(resolveRenderableWorkspacePaneTab('terminal', ctx({ terminalSessionCount: 1 }))).toBe('terminal')
    expect(resolveRenderableWorkspacePaneTab('terminal', ctx({ terminalSessionCount: 7 }))).toBe('terminal')
  })

  test('returns null for terminal after sync confirms the worktree has no terminal sessions', () => {
    expect(resolveRenderableWorkspacePaneTab('terminal', ctx({ terminalSessionCount: 0 }))).toBeNull()
  })

  test('does not dismiss terminal when sync settled with non-zero sessions', () => {
    expect(resolveRenderableWorkspacePaneTab('terminal', ctx({ terminalSessionCount: 1 }))).toBe('terminal')
  })

  test('is total over the inputs', () => {
    const cases: Array<[WorkspacePaneTabType, WorkspacePaneRenderabilityContext, WorkspacePaneTabType | null]> = [
      ['status', ctx(), 'status'],
      ['status', ctx({ hasWorktree: false, terminalProjectionPhase: 'pending' }), 'status'],
      ['history', ctx(), 'history'],
      ['history', ctx({ hasWorktree: false }), 'history'],
      ['changes', ctx(), 'changes'],
      ['changes', ctx({ hasWorktree: false }), null],
      ['terminal', ctx({ hasWorktree: false }), null],
      ['terminal', ctx({ terminalProjectionPhase: 'pending' }), 'terminal'],
      ['terminal', ctx({ terminalCreatePending: true }), 'terminal'],
      ['terminal', ctx({ terminalSessionCount: 0 }), null],
      ['terminal', ctx({ terminalSessionCount: 3 }), 'terminal'],
    ]
    for (const [preferred, context, expected] of cases) {
      expect(resolveRenderableWorkspacePaneTab(preferred, context)).toBe(expected)
    }
  })
})

describe('workspacePaneTabScope', () => {
  test('classifies status/history as branch-level and changes/terminal as worktree-level', () => {
    expect(workspacePaneTabScope('status')).toBe('branch')
    expect(isBranchLevelWorkspacePaneTab('status')).toBe(true)
    expect(workspacePaneTabScope('history')).toBe('branch')
    expect(isBranchLevelWorkspacePaneTab('history')).toBe(true)
    expect(workspacePaneTabScope('changes')).toBe('worktree')
    expect(workspacePaneTabScope('terminal')).toBe('worktree')
    expect(isWorktreeLevelWorkspacePaneTab('changes')).toBe(true)
    expect(isWorktreeLevelWorkspacePaneTab('terminal')).toBe(true)
  })
})
