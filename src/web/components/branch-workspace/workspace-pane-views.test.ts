import { describe, expect, test } from 'vitest'
import {
  workspacePaneStaticViewCloseLabel,
  workspacePaneStaticViewLabel,
  workspacePaneStaticViewTooltip,
} from '#/web/components/branch-workspace/workspace-pane-views.ts'

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

describe('workspacePaneStaticViewLabel', () => {
  test('shows the changes count inline when present', () => {
    expect(workspacePaneStaticViewLabel('changes', t, 3)).toBe('变更 · 3个')
  })

  test('keeps the plain changes label when there are no changes', () => {
    expect(workspacePaneStaticViewLabel('changes', t, 0)).toBe('变更')
  })

  test('does not include the count in close labels', () => {
    expect(workspacePaneStaticViewCloseLabel('changes', t)).toBe('关闭变更')
  })
})

describe('workspacePaneStaticViewTooltip', () => {
  test('passes the changes count through to the changes tooltip', () => {
    expect(
      workspacePaneStaticViewTooltip({ tab: 'changes', branchName: 'main', statusCount: 7, t }),
    ).toBe('7 个文件变更')
  })

  test('appends the branch name to the status tooltip', () => {
    expect(workspacePaneStaticViewTooltip({ tab: 'status', branchName: 'main', statusCount: 0, t })).toBe(
      '状态 · main',
    )
  })

  test('falls back to the plain label when no branch is selected', () => {
    expect(workspacePaneStaticViewTooltip({ tab: 'status', branchName: '', statusCount: 0, t })).toBe('状态')
  })

  test('appends the branch name to the history tooltip', () => {
    expect(workspacePaneStaticViewTooltip({ tab: 'history', branchName: 'main', statusCount: 0, t })).toBe(
      '历史 · main',
    )
  })
})
