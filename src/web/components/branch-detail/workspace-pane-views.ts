import type { WorkspacePaneViewSummary } from '#/web/components/terminal/types.ts'
import { isTerminalWorkspacePaneView } from '#/web/components/workspace-pane/workspace-pane-view-model.ts'
import type { BranchLevelWorkspacePaneView } from '#/web/lib/workspace-pane-view.ts'

type T = (key: string, params?: Record<string, string | number>) => string

export const BRANCH_LEVEL_WORKSPACE_PANE_VIEWS = [
  { type: 'status', labelKey: 'tab.status' },
] as const satisfies readonly {
  type: BranchLevelWorkspacePaneView
  labelKey: string
}[]

export function branchLevelWorkspacePaneViewButtonId(
  detailId: string,
  type: BranchLevelWorkspacePaneView,
): string {
  return `${detailId}-${type}-tab`
}

export function branchWorkspacePaneViewLabel(tab: WorkspacePaneViewSummary, t: T, statusCount?: number): string {
  if (tab.type === 'changes') {
    if (statusCount && statusCount > 0) return t('tab.changes-with-count', { count: statusCount })
    return t('tab.changes')
  }
  return tab.title
}

export function branchWorkspacePaneViewTooltip(input: {
  tab: WorkspacePaneViewSummary
  branchName: string
  statusCount: number
  t: T
}): string {
  if (input.tab.type === 'changes') return input.t('workspace-pane-views.changes-tooltip', { count: input.statusCount })
  return input.tab.originalTitle ?? input.tab.fullTitle ?? input.tab.title
}

export function branchWorkspacePaneViewCloseLabel(tab: WorkspacePaneViewSummary, t: T): string {
  if (isTerminalWorkspacePaneView(tab)) return t('terminal.close-named', { name: tab.title })
  return t('workspace-pane-views.close-named', { name: branchWorkspacePaneViewLabel(tab, t) })
}
