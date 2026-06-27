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
  repoWorkspaceActive = false,
}: {
  compact?: boolean
  zenMode?: boolean
  repoWorkspaceActive?: boolean
}): RepoWorkspaceBehavior {
  const branchNavigatorCollapsed = !compact && zenMode && repoWorkspaceActive
  const singlePane = compact || (zenMode && !repoWorkspaceActive)
  return {
    mode: singlePane ? 'single-pane' : 'split',
    singlePane,
    compact,
    zenMode,
    branchNavigatorCollapsed,
  }
}
