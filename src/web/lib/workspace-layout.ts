export type RepoWorkspaceMode = 'split' | 'single-pane'

export interface RepoWorkspaceBehavior {
  mode: RepoWorkspaceMode
  singlePane: boolean
  compact: boolean
  zenMode: boolean
  branchNavigatorCollapsed: boolean
}

export function repoWorkspaceBehavior({
  compact = false,
  zenMode = false,
  branchWorkspaceActive = false,
}: {
  compact?: boolean
  zenMode?: boolean
  branchWorkspaceActive?: boolean
}): RepoWorkspaceBehavior {
  const branchNavigatorCollapsed = !compact && zenMode && branchWorkspaceActive
  const singlePane = compact || (zenMode && !branchWorkspaceActive)
  return {
    mode: singlePane ? 'single-pane' : 'split',
    singlePane,
    compact,
    zenMode,
    branchNavigatorCollapsed,
  }
}
