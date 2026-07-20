export type WorkspaceLayoutMode = 'split' | 'single-pane'

export interface WorkspaceLayoutBehavior {
  mode: WorkspaceLayoutMode
  singlePane: boolean
  compact: boolean
  zenMode: boolean
  sidebarCollapsed: boolean
}

export function workspaceLayoutBehavior({
  compact = false,
  zenMode = false,
  workspacePaneActive = false,
}: {
  compact?: boolean
  zenMode?: boolean
  workspacePaneActive?: boolean
}): WorkspaceLayoutBehavior {
  const sidebarCollapsed = !compact && zenMode && workspacePaneActive
  const singlePane = compact || (zenMode && !workspacePaneActive)
  return {
    mode: singlePane ? 'single-pane' : 'split',
    singlePane,
    compact,
    zenMode,
    sidebarCollapsed,
  }
}
