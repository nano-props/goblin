import { describe, expect, test } from 'vitest'
import {
  branchWorkspacePaneViewCloseLabel,
  branchWorkspacePaneViewLabel,
} from '#/web/components/branch-detail/workspace-pane-views.ts'
import type { WorkspacePaneViewSummary } from '#/web/components/terminal/types.ts'

const changesTab: WorkspacePaneViewSummary = {
  type: 'changes',
  id: 'changes',
  key: 'changes',
  worktreeTerminalKey: '/repo\0/worktree',
  worktreePath: '/worktree',
  displayOrder: 2,
}

const t = (key: string, params?: Record<string, string | number>) => {
  if (key === 'tab.changes') return '变更'
  if (key === 'tab.changes-with-count') return `变更 · ${params?.count}个`
  if (key === 'workspace-pane-views.close-named') return `关闭${params?.name}`
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
