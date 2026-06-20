import type { WorkspaceLayout } from '#/shared/workspace-layout.ts'
export type RepoWorkspaceMode = 'split' | 'workspace-only'

export interface RepoWorkspaceBehavior {
  mode: RepoWorkspaceMode
  branchListPaneVisible: boolean
  branchListActionsVisible: boolean
  prTooltipSide: 'right' | 'bottom'
}

export function repoWorkspaceBehavior(
  _layout: WorkspaceLayout,
  branchListPaneVisible = true,
): RepoWorkspaceBehavior {
  return {
    mode: branchListPaneVisible ? 'split' : 'workspace-only',
    branchListPaneVisible,
    branchListActionsVisible: branchListPaneVisible,
    prTooltipSide: 'bottom',
  }
}
