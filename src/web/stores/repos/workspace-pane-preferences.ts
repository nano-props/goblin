import type { RepoUiState } from '#/web/stores/repos/types.ts'
import type { WorkspacePaneTabType } from '#/shared/workspace-pane.ts'

export function preferredWorkspacePaneViewForBranch(
  ui: Pick<RepoUiState, 'selectedBranch' | 'preferredWorkspacePaneViewByBranch'>,
  branchName: string | null | undefined = ui.selectedBranch,
): WorkspacePaneTabType {
  return branchName ? (ui.preferredWorkspacePaneViewByBranch[branchName] ?? 'status') : 'status'
}

export function preferredWorkspacePaneViewByBranchRecordWith(
  ui: Pick<RepoUiState, 'preferredWorkspacePaneViewByBranch'>,
  branchName: string,
  view: WorkspacePaneTabType,
): Record<string, WorkspacePaneTabType> {
  return {
    ...ui.preferredWorkspacePaneViewByBranch,
    [branchName]: view,
  }
}
