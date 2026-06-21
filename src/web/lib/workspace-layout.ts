import type { WorkspaceLayout } from '#/shared/workspace-layout.ts'
export type RepoWorkspaceMode = 'split' | 'single-pane'

export interface RepoWorkspaceBehavior {
  mode: RepoWorkspaceMode
  singlePane: boolean
  compact: boolean
  workspaceFocused: boolean
  branchNavigatorCollapsed: boolean
  branchNavigatorActionsVisible: boolean
  prTooltipSide: 'right' | 'bottom'
}

export function repoWorkspaceBehavior({
  layout: _layout,
  compact = false,
  workspaceFocused = false,
  branchWorkspaceActive = false,
}: {
  layout: WorkspaceLayout
  compact?: boolean
  workspaceFocused?: boolean
  branchWorkspaceActive?: boolean
}): RepoWorkspaceBehavior {
  const branchNavigatorCollapsed = !compact && workspaceFocused && branchWorkspaceActive
  const singlePane = compact || (workspaceFocused && !branchWorkspaceActive)
  return {
    mode: singlePane ? 'single-pane' : 'split',
    singlePane,
    compact,
    workspaceFocused,
    branchNavigatorCollapsed,
    branchNavigatorActionsVisible: true,
    prTooltipSide: 'bottom',
  }
}
