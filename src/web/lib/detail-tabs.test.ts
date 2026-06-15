import { describe, expect, test } from 'vitest'
import type { DetailTab } from '#/web/stores/repos/types.ts'
import { computeEffectiveDetailTab, type DetailTabContext, visibleDetailTabs } from '#/web/lib/detail-tabs.ts'

function ctx(overrides: Partial<DetailTabContext> = {}): DetailTabContext {
  return {
    hasWorktree: true,
    hasChanges: false,
    terminalSessionCount: 0,
    terminalSyncReady: true,
    ...overrides,
  }
}

describe('computeEffectiveDetailTab', () => {
  test('preserves a non-terminal preference verbatim', () => {
    expect(computeEffectiveDetailTab('status', ctx())).toBe('status')
    expect(computeEffectiveDetailTab('changes', ctx({ hasChanges: true }))).toBe('changes')
  })

  test('routes a changes preference to status when the worktree is clean', () => {
    // The persisted preference is preserved; the UI just has nothing to
    // show on the changes tab, so the effective tab falls back to status.
    expect(computeEffectiveDetailTab('changes', ctx({ hasChanges: false }))).toBe('status')
    expect(computeEffectiveDetailTab('changes', ctx({ hasChanges: false, terminalSessionCount: 7 }))).toBe('status')
  })

  test('keeps the changes preference when there is at least one change', () => {
    expect(computeEffectiveDetailTab('changes', ctx({ hasChanges: true }))).toBe('changes')
  })

  test('falls back to status when no worktree exists, regardless of preference', () => {
    expect(computeEffectiveDetailTab('terminal', ctx({ hasWorktree: false }))).toBe('status')
    expect(computeEffectiveDetailTab('terminal', ctx({ hasWorktree: false, terminalSessionCount: 5 }))).toBe('status')
  })

  test('preserves the terminal preference when sync has not yet settled', () => {
    // syncReady=false means we don't yet know the session count; avoid
    // flashing status → terminal → status during boot.
    expect(computeEffectiveDetailTab('terminal', ctx({ terminalSyncReady: false }))).toBe('terminal')
  })

  test('keeps the terminal preference when the active worktree has at least one session', () => {
    expect(computeEffectiveDetailTab('terminal', ctx({ terminalSessionCount: 1 }))).toBe('terminal')
    expect(computeEffectiveDetailTab('terminal', ctx({ terminalSessionCount: 7 }))).toBe('terminal')
  })

  test('dismisses the terminal preference to status when sync has settled and the worktree is empty', () => {
    expect(computeEffectiveDetailTab('terminal', ctx({ terminalSessionCount: 0 }))).toBe('status')
  })

  test('keeps terminal renderable while a create request is pending', () => {
    expect(computeEffectiveDetailTab('terminal', ctx({ terminalPendingCreate: true }))).toBe('terminal')
  })

  test('does not dismiss terminal when sync settled with non-zero sessions', () => {
    expect(computeEffectiveDetailTab('terminal', ctx({ terminalSessionCount: 1 }))).toBe('terminal')
  })

  test('is total over the inputs', () => {
    const cases: Array<[DetailTab, DetailTabContext, DetailTab]> = [
      ['status', ctx(), 'status'],
      ['status', ctx({ hasWorktree: false, terminalSyncReady: false }), 'status'],
      ['changes', ctx({ hasChanges: true }), 'changes'],
      ['changes', ctx({ hasChanges: false }), 'status'],
      ['changes', ctx({ hasWorktree: false, hasChanges: true }), 'changes'],
      ['terminal', ctx({ hasWorktree: false }), 'status'],
      ['terminal', ctx({ terminalSyncReady: false }), 'terminal'],
      ['terminal', ctx({ terminalSessionCount: 0 }), 'status'],
      ['terminal', ctx({ terminalPendingCreate: true }), 'terminal'],
      ['terminal', ctx({ terminalSessionCount: 3 }), 'terminal'],
    ]
    for (const [preferred, context, expected] of cases) {
      expect(computeEffectiveDetailTab(preferred, context)).toBe(expected)
    }
  })
})

describe('visibleDetailTabs', () => {
  test('returns all three tabs when the worktree exists and is dirty', () => {
    expect(visibleDetailTabs({ hasWorktree: true, hasChanges: true }).map((t) => t.id)).toEqual([
      'status',
      'changes',
      'terminal',
    ])
  })

  test('hides the changes tab when the worktree is clean', () => {
    expect(visibleDetailTabs({ hasWorktree: true, hasChanges: false }).map((t) => t.id)).toEqual(['status', 'terminal'])
  })

  test('hides the terminal tab when the branch has no worktree', () => {
    expect(visibleDetailTabs({ hasWorktree: false, hasChanges: true }).map((t) => t.id)).toEqual(['status', 'changes'])
    expect(visibleDetailTabs({ hasWorktree: false, hasChanges: false }).map((t) => t.id)).toEqual(['status'])
  })
})
