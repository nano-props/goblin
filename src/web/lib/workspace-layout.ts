export type RepoWorkspaceMode = 'split' | 'single-pane'

export interface RepoWorkspaceBehavior {
  mode: RepoWorkspaceMode
  singlePane: boolean
  compact: boolean
  workspaceFocused: boolean
  branchNavigatorCollapsed: boolean
}

export function repoWorkspaceBehavior({
  compact = false,
  workspaceFocused = false,
  branchWorkspaceActive = false,
}: {
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
  }
}
