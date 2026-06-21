import type { WorkspacePaneViewSummary } from '#/web/components/terminal/types.ts'
import { isTerminalWorkspacePaneView } from '#/web/components/workspace-pane/workspace-pane-view-model.ts'
import type { BranchLevelWorkspacePaneView } from '#/web/lib/workspace-pane-view.ts'

type T = (key: string, params?: Record<string, string | number>) => string

export const BRANCH_LEVEL_WORKSPACE_PANE_VIEWS = [
  { type: 'status', labelKey: 'tab.status' },
  { type: 'history', labelKey: 'tab.log' },
] as const satisfies readonly {
  type: BranchLevelWorkspacePaneView
  labelKey: string
}[]

export function branchLevelWorkspacePaneViewButtonId(
  workspacePaneId: string,
  type: BranchLevelWorkspacePaneView,
): string {
  return `${workspacePaneId}-${type}-tab`
}

export function branchLevelWorkspacePaneViewDefinition(
  type: BranchLevelWorkspacePaneView,
): (typeof BRANCH_LEVEL_WORKSPACE_PANE_VIEWS)[number] | null {
  return BRANCH_LEVEL_WORKSPACE_PANE_VIEWS.find((tab) => tab.type === type) ?? null
}

export function branchLevelWorkspacePaneViewLabel(tab: BranchLevelWorkspacePaneView, t: T): string {
  if (tab === 'status') return t('tab.status')
  if (tab === 'history') return t('tab.log')
  const exhaustive: never = tab
  return exhaustive
}

export function branchLevelWorkspacePaneViewCloseLabel(tab: BranchLevelWorkspacePaneView, t: T): string {
  return t('workspace-pane-views.close-named', { name: branchLevelWorkspacePaneViewLabel(tab, t) })
}

export function branchWorkspacePaneViewLabel(tab: WorkspacePaneViewSummary, t: T, statusCount?: number): string {
  if (tab.type === 'status') return t('tab.status')
  if (tab.type === 'history') return t('tab.log')
  if (tab.type === 'changes') {
    if (statusCount && statusCount > 0) return t('tab.changes-with-count', { count: statusCount })
    return t('tab.changes')
  }
  if (isTerminalWorkspacePaneView(tab)) return tab.title
  return tab.type
}

export function branchWorkspacePaneViewTooltip(input: {
  tab: WorkspacePaneViewSummary
  branchName: string
  statusCount: number
  t: T
}): string {
  if (input.tab.type === 'status') return input.t('tab.status')
  if (input.tab.type === 'history') return input.t('tab.log')
  if (input.tab.type === 'changes') return input.t('workspace-pane-views.changes-tooltip', { count: input.statusCount })
  if (isTerminalWorkspacePaneView(input.tab)) return input.tab.originalTitle ?? input.tab.fullTitle ?? input.tab.title
  return input.tab.type
}

export function branchWorkspacePaneViewCloseLabel(tab: WorkspacePaneViewSummary, t: T): string {
  if (isTerminalWorkspacePaneView(tab)) return t('terminal.close-named', { name: tab.title })
  return t('workspace-pane-views.close-named', { name: branchWorkspacePaneViewLabel(tab, t) })
}
