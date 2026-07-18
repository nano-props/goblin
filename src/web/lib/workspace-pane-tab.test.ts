import { describe, expect, test } from 'vitest'
import type { WorkspacePaneTabType } from '#/shared/workspace-pane.ts'
import {
  isBranchLevelWorkspacePaneTab,
  isWorktreeLevelWorkspacePaneTab,
  resolveRenderableWorkspacePaneTab,
  workspacePaneTabScope,
  type WorkspacePaneRenderabilityContext,
} from '#/web/lib/workspace-pane-tab.ts'
import type { WorkspacePaneRuntimeTabAvailability } from '#/web/workspace-pane/tab-providers.ts'

function terminalAvailability(
  overrides: Partial<WorkspacePaneRuntimeTabAvailability> = {},
): WorkspacePaneRuntimeTabAvailability {
  return {
    sessionCount: 0,
    createPending: false,
    projectionPhase: 'ready',
    ...overrides,
  }
}

function ctx(overrides: Partial<WorkspacePaneRenderabilityContext> = {}): WorkspacePaneRenderabilityContext {
  return {
    hasWorktree: true,
    runtimeTabAvailabilityByType: { terminal: terminalAvailability() },
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
    expect(
      resolveRenderableWorkspacePaneTab(
        'changes',
        ctx({ runtimeTabAvailabilityByType: { terminal: terminalAvailability({ sessionCount: 7 }) } }),
      ),
    ).toBe('changes')
  })

  test('returns null for worktree-scoped preferences when no worktree exists', () => {
    expect(resolveRenderableWorkspacePaneTab('changes', ctx({ hasWorktree: false }))).toBeNull()
    expect(resolveRenderableWorkspacePaneTab('terminal', ctx({ hasWorktree: false }))).toBeNull()
    expect(
      resolveRenderableWorkspacePaneTab(
        'terminal',
        ctx({
          hasWorktree: false,
          runtimeTabAvailabilityByType: { terminal: terminalAvailability({ sessionCount: 5 }) },
        }),
      ),
    ).toBeNull()
    expect(resolveRenderableWorkspacePaneTab('history', ctx({ hasWorktree: false }))).toBe('history')
  })

  test('preserves the terminal preference while sync is unresolved', () => {
    expect(
      resolveRenderableWorkspacePaneTab(
        'terminal',
        ctx({ runtimeTabAvailabilityByType: { terminal: terminalAvailability({ projectionPhase: 'pending' }) } }),
      ),
    ).toBe('terminal')
  })

  test('preserves the terminal preference while terminal creation is pending', () => {
    expect(
      resolveRenderableWorkspacePaneTab(
        'terminal',
        ctx({ runtimeTabAvailabilityByType: { terminal: terminalAvailability({ createPending: true }) } }),
      ),
    ).toBe('terminal')
  })

  test('keeps the terminal preference when the active worktree has at least one session', () => {
    expect(
      resolveRenderableWorkspacePaneTab(
        'terminal',
        ctx({ runtimeTabAvailabilityByType: { terminal: terminalAvailability({ sessionCount: 1 }) } }),
      ),
    ).toBe('terminal')
    expect(
      resolveRenderableWorkspacePaneTab(
        'terminal',
        ctx({ runtimeTabAvailabilityByType: { terminal: terminalAvailability({ sessionCount: 7 }) } }),
      ),
    ).toBe('terminal')
  })

  test('uses runtime availability when it is provided', () => {
    expect(
      resolveRenderableWorkspacePaneTab(
        'terminal',
        ctx({
          runtimeTabAvailabilityByType: {
            terminal: {
              sessionCount: 1,
              createPending: false,
              projectionPhase: 'ready',
            },
          },
        }),
      ),
    ).toBe('terminal')
  })

  test('returns null for terminal after sync confirms the worktree has no terminal sessions', () => {
    expect(
      resolveRenderableWorkspacePaneTab(
        'terminal',
        ctx({ runtimeTabAvailabilityByType: { terminal: terminalAvailability({ sessionCount: 0 }) } }),
      ),
    ).toBeNull()
  })

  test('does not dismiss terminal when sync settled with non-zero sessions', () => {
    expect(
      resolveRenderableWorkspacePaneTab(
        'terminal',
        ctx({ runtimeTabAvailabilityByType: { terminal: terminalAvailability({ sessionCount: 1 }) } }),
      ),
    ).toBe('terminal')
  })

  test('is total over the inputs', () => {
    const cases: Array<[WorkspacePaneTabType, WorkspacePaneRenderabilityContext, WorkspacePaneTabType | null]> = [
      ['status', ctx(), 'status'],
      [
        'status',
        ctx({
          hasWorktree: false,
          runtimeTabAvailabilityByType: { terminal: terminalAvailability({ projectionPhase: 'pending' }) },
        }),
        'status',
      ],
      ['history', ctx(), 'history'],
      ['history', ctx({ hasWorktree: false }), 'history'],
      ['changes', ctx(), 'changes'],
      ['changes', ctx({ hasWorktree: false }), null],
      ['terminal', ctx({ hasWorktree: false }), null],
      [
        'terminal',
        ctx({ runtimeTabAvailabilityByType: { terminal: terminalAvailability({ projectionPhase: 'pending' }) } }),
        'terminal',
      ],
      [
        'terminal',
        ctx({ runtimeTabAvailabilityByType: { terminal: terminalAvailability({ createPending: true }) } }),
        'terminal',
      ],
      [
        'terminal',
        ctx({ runtimeTabAvailabilityByType: { terminal: terminalAvailability({ sessionCount: 0 }) } }),
        null,
      ],
      [
        'terminal',
        ctx({ runtimeTabAvailabilityByType: { terminal: terminalAvailability({ sessionCount: 3 }) } }),
        'terminal',
      ],
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
