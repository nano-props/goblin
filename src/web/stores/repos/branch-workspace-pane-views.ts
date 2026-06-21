import type { RepoUiState } from '#/web/stores/repos/types.ts'
import type { WorkspacePaneBranchViewType } from '#/shared/workspace-pane.ts'

export const DEFAULT_BRANCH_WORKSPACE_PANE_VIEWS: readonly WorkspacePaneBranchViewType[] = ['status']

export function branchWorkspacePaneViewsForBranch(
  ui: Pick<RepoUiState, 'openBranchWorkspacePaneViewsByBranch'>,
  branch: string | null | undefined,
): WorkspacePaneBranchViewType[] {
  if (!branch) return []
  const views = ui.openBranchWorkspacePaneViewsByBranch[branch]
  return views ? [...views] : [...DEFAULT_BRANCH_WORKSPACE_PANE_VIEWS]
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
