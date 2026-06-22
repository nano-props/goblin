import type { RepoUiState } from '#/web/stores/repos/types.ts'
import type { WorkspacePaneBranchViewType } from '#/shared/workspace-pane.ts'
import { isWorkspacePaneBranchViewType } from '#/shared/workspace-pane.ts'

export const DEFAULT_BRANCH_WORKSPACE_PANE_VIEWS: readonly WorkspacePaneBranchViewType[] = ['status']

export function branchWorkspacePaneViewsForBranch(
  ui: Pick<RepoUiState, 'openBranchWorkspacePaneViewsByBranch'>,
  branch: string | null | undefined,
): WorkspacePaneBranchViewType[] {
  if (!branch) return []
  return [...(ui.openBranchWorkspacePaneViewsByBranch[branch] ?? [])]
}

export function branchWorkspacePaneViewsRecordWith(
  ui: Pick<RepoUiState, 'openBranchWorkspacePaneViewsByBranch'>,
  branch: string,
  views: readonly WorkspacePaneBranchViewType[],
): Record<string, WorkspacePaneBranchViewType[]> {
  return {
    ...ui.openBranchWorkspacePaneViewsByBranch,
    [branch]: [...views],
  }
}

export function normalizeBranchWorkspacePaneViewsRecord(
  value: Record<string, readonly WorkspacePaneBranchViewType[]>,
  branchNames: readonly string[],
): Record<string, WorkspacePaneBranchViewType[]> {
  const next: Record<string, WorkspacePaneBranchViewType[]> = {}
  for (const branch of branchNames) {
    const current = Object.prototype.hasOwnProperty.call(value, branch)
      ? value[branch]
      : DEFAULT_BRANCH_WORKSPACE_PANE_VIEWS
    next[branch] = normalizedBranchWorkspacePaneViews(current)
  }
  return next
}

function normalizedBranchWorkspacePaneViews(
  views: readonly WorkspacePaneBranchViewType[],
): WorkspacePaneBranchViewType[] {
  const next: WorkspacePaneBranchViewType[] = []
  for (const view of views) {
    if (!isWorkspacePaneBranchViewType(view)) continue
    if (!next.includes(view)) next.push(view)
  }
  return next
}
