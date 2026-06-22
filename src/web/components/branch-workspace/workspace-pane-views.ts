import type { WorkspacePaneViewSummary } from '#/web/components/terminal/types.ts'
import type { WorkspacePaneStaticViewType } from '#/shared/workspace-pane.ts'

type T = (key: string, params?: Record<string, string | number>) => string

export function workspacePaneStaticViewButtonId(workspacePaneId: string, type: WorkspacePaneStaticViewType): string {
  return `${workspacePaneId}-${type}-tab`
}

export function workspacePaneStaticViewLabel(tab: WorkspacePaneStaticViewType, t: T, statusCount?: number): string {
  if (tab === 'status') return t('tab.status')
  if (tab === 'changes') {
    if (statusCount && statusCount > 0) return t('tab.changes-with-count', { count: statusCount })
    return t('tab.changes')
  }
  if (tab === 'history') return t('tab.log')
  const exhaustive: never = tab
  return exhaustive
}

export function workspacePaneStaticViewCloseLabel(tab: WorkspacePaneStaticViewType, t: T): string {
  return t('workspace-pane-views.close-named', { name: workspacePaneStaticViewLabel(tab, t) })
}

export function branchWorkspacePaneViewLabel(tab: WorkspacePaneViewSummary, _t: T, _statusCount?: number): string {
  return tab.title
}

function branchScopedViewTooltip(input: {
  kind: 'status' | 'history'
  branchName: string
  t: T
}): string {
  const fallbackKey = input.kind === 'status' ? 'tab.status' : 'tab.log'
  if (!input.branchName) return input.t(fallbackKey)
  return input.t(`workspace-pane-views.${input.kind}-tooltip`, { branch: input.branchName })
}

export function branchWorkspacePaneViewTooltip(input: {
  tab: WorkspacePaneViewSummary
  branchName: string
  statusCount: number
  t: T
}): string {
  return input.tab.originalTitle ?? input.tab.fullTitle ?? input.tab.title
}

export function workspacePaneStaticViewTooltip(input: {
  tab: WorkspacePaneStaticViewType
  branchName: string
  statusCount: number
  t: T
}): string {
  if (input.tab === 'changes') return input.t('workspace-pane-views.changes-tooltip', { count: input.statusCount })
  if (input.tab === 'status') return branchScopedViewTooltip({ kind: 'status', ...input })
  if (input.tab === 'history') return branchScopedViewTooltip({ kind: 'history', ...input })
  const exhaustive: never = input.tab
  return exhaustive
}

export function branchWorkspacePaneViewCloseLabel(tab: WorkspacePaneViewSummary, t: T): string {
  return t('terminal.close-named', { name: tab.title })
}
