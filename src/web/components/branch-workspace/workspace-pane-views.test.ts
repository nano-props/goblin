import { describe, expect, test } from 'vitest'
import {
  branchLevelWorkspacePaneViewTooltip,
  branchWorkspacePaneViewCloseLabel,
  branchWorkspacePaneViewLabel,
  branchWorkspacePaneViewTooltip,
} from '#/web/components/branch-workspace/workspace-pane-views.ts'
import type { WorkspacePaneViewSummary } from '#/web/components/terminal/types.ts'

const changesTab: WorkspacePaneViewSummary = {
  type: 'changes',
  id: 'changes',
  key: 'changes',
  worktreeTerminalKey: '/repo\0/worktree',
  worktreePath: '/worktree',
  displayOrder: 2,
}

const statusTab: WorkspacePaneViewSummary = {
  type: 'status',
  id: 'status',
  key: 'status',
  worktreeTerminalKey: '/repo\0/worktree',
  worktreePath: '/worktree',
  displayOrder: 1,
}

const historyTab: WorkspacePaneViewSummary = {
  type: 'history',
  id: 'history',
  key: 'history',
  worktreeTerminalKey: '/repo\0/worktree',
  worktreePath: '/worktree',
  displayOrder: 3,
}

const t = (key: string, params?: Record<string, string | number>) => {
  if (key === 'tab.status') return '状态'
  if (key === 'tab.log') return '历史'
  if (key === 'tab.changes') return '变更'
  if (key === 'tab.changes-with-count') return `变更 · ${params?.count}个`
  if (key === 'workspace-pane-views.close-named') return `关闭${params?.name}`
  if (key === 'workspace-pane-views.status-tooltip') return `状态 · ${params?.branch}`
  if (key === 'workspace-pane-views.history-tooltip') return `历史 · ${params?.branch}`
  if (key === 'workspace-pane-views.changes-tooltip') return `${params?.count} 个文件变更`
  return key
}

describe('branchWorkspacePaneViewLabel', () => {
  test('shows the changes count inline when present', () => {
    expect(branchWorkspacePaneViewLabel(changesTab, t, 3)).toBe('变更 · 3个')
  })

  test('keeps the plain changes label when there are no changes', () => {
    expect(branchWorkspacePaneViewLabel(changesTab, t, 0)).toBe('变更')
  })

  test('does not include the count in close labels', () => {
    expect(branchWorkspacePaneViewCloseLabel(changesTab, t)).toBe('关闭变更')
  })
})

describe('branchWorkspacePaneViewTooltip', () => {
  test('appends the branch name to the status tooltip when a branch is selected', () => {
    expect(
      branchWorkspacePaneViewTooltip({ tab: statusTab, branchName: 'feature/foo', statusCount: 0, t }),
    ).toBe('状态 · feature/foo')
  })

  test('falls back to the plain status label when no branch is selected', () => {
    expect(branchWorkspacePaneViewTooltip({ tab: statusTab, branchName: '', statusCount: 0, t })).toBe('状态')
  })

  test('appends the branch name to the history tooltip when a branch is selected', () => {
    expect(
      branchWorkspacePaneViewTooltip({ tab: historyTab, branchName: 'main', statusCount: 0, t }),
    ).toBe('历史 · main')
  })

  test('passes the changes count through to the changes tooltip', () => {
    expect(
      branchWorkspacePaneViewTooltip({ tab: changesTab, branchName: 'main', statusCount: 7, t }),
    ).toBe('7 个文件变更')
  })
})

describe('branchLevelWorkspacePaneViewTooltip', () => {
  test('appends the branch name to the status tooltip', () => {
    expect(branchLevelWorkspacePaneViewTooltip({ tab: 'status', branchName: 'main', t })).toBe('状态 · main')
  })

  test('falls back to the plain label when no branch is selected', () => {
    expect(branchLevelWorkspacePaneViewTooltip({ tab: 'status', branchName: '', t })).toBe('状态')
  })

  test('appends the branch name to the history tooltip', () => {
    expect(branchLevelWorkspacePaneViewTooltip({ tab: 'history', branchName: 'main', t })).toBe('历史 · main')
  })
})
