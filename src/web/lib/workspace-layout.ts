export type RepoWorkspaceMode = 'split' | 'single-pane'

export interface RepoWorkspaceBehavior {
  mode: RepoWorkspaceMode
  singlePane: boolean
  compact: boolean
  zenMode: boolean
  sidebarCollapsed: boolean
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
  const sidebarCollapsed = !compact && zenMode && repoWorkspaceActive
  const singlePane = compact || (zenMode && !repoWorkspaceActive)
  return {
    mode: singlePane ? 'single-pane' : 'split',
    singlePane,
    compact,
    zenMode,
    sidebarCollapsed,
  }
}
