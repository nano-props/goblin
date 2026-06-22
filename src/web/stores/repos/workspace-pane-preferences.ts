import type { RepoUiState } from '#/web/stores/repos/types.ts'
import type { WorkspacePaneView } from '#/shared/workspace-pane.ts'

export function preferredWorkspacePaneViewForBranch(
  ui: Pick<RepoUiState, 'selectedBranch' | 'preferredWorkspacePaneViewByBranch'>,
  branchName: string | null | undefined = ui.selectedBranch,
): WorkspacePaneView {
  return branchName ? (ui.preferredWorkspacePaneViewByBranch[branchName] ?? 'status') : 'status'
}

export function preferredWorkspacePaneViewByBranchRecordWith(
  ui: Pick<RepoUiState, 'preferredWorkspacePaneViewByBranch'>,
  branchName: string,
  view: WorkspacePaneView,
): Record<string, WorkspacePaneView> {
  return {
    ...ui.preferredWorkspacePaneViewByBranch,
    [branchName]: view,
  }
}
