import type { RepoUiState } from '#/web/stores/repos/types.ts'
import type { WorkspacePaneTabType } from '#/shared/workspace-pane.ts'

export function preferredWorkspacePaneTabForBranch(
  ui: Pick<RepoUiState, 'selectedBranch' | 'preferredWorkspacePaneTabByBranch'>,
  branchName: string | null | undefined = ui.selectedBranch,
): WorkspacePaneTabType {
  return branchName ? (ui.preferredWorkspacePaneTabByBranch[branchName] ?? 'status') : 'status'
}

export function preferredWorkspacePaneTabByBranchRecordWith(
  ui: Pick<RepoUiState, 'preferredWorkspacePaneTabByBranch'>,
  branchName: string,
  view: WorkspacePaneTabType,
): Record<string, WorkspacePaneTabType> {
  return {
    ...ui.preferredWorkspacePaneTabByBranch,
    [branchName]: view,
  }
}
