import type { WorkspacePaneViewSummary } from '#/web/components/terminal/types.ts'
import { isTerminalWorkspacePaneView } from '#/web/components/workspace-pane/workspace-pane-view-model.ts'

type T = (key: string, params?: Record<string, string | number>) => string

export function branchWorkspacePaneViewLabel(tab: WorkspacePaneViewSummary, t: T): string {
  if (tab.type === 'status') return t('tab.status')
  if (tab.type === 'changes') return t('tab.changes')
  if (!isTerminalWorkspacePaneView(tab)) return tab.type
  return tab.title
}

export function branchWorkspacePaneViewTooltip(input: {
  tab: WorkspacePaneViewSummary
  branchName: string
  statusCount: number
  t: T
}): string {
  if (input.tab.type === 'status') return input.branchName
  if (input.tab.type === 'changes') return input.t('workspace-pane-views.changes-tooltip', { count: input.statusCount })
  if (!isTerminalWorkspacePaneView(input.tab)) return input.tab.type
  return input.tab.originalTitle ?? input.tab.fullTitle ?? input.tab.title
}

export function branchWorkspacePaneViewCloseLabel(tab: WorkspacePaneViewSummary, t: T): string {
  if (isTerminalWorkspacePaneView(tab)) return t('terminal.close-named', { name: tab.title })
  return t('workspace-pane-views.close-named', { name: branchWorkspacePaneViewLabel(tab, t) })
}
