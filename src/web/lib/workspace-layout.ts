export type RepoWorkspaceMode = 'split' | 'single-pane'

export interface RepoWorkspaceBehavior {
  mode: RepoWorkspaceMode
  singlePane: boolean
  compact: boolean
  workspaceFocused: boolean
  branchNavigatorCollapsed: boolean
  /** Whether the branch navigator pane is actually rendered to the user
   * (not collapsed and not hidden behind the workspace pane). The
   * worktree-filter toggle only makes sense when there is a branch
   * list to filter, so it should not render when this is false. */
  branchNavigatorVisible: boolean
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
  // The branch navigator is hidden in every configuration where the
  // workspace pane takes over the whole viewport: compact mode shows
  // either the navigator or the workspace as the single pane (never
  // both), and large-screen Focus Mode either collapses the
  // navigator or replaces it with the workspace pane entirely. In
  // both cases the user has no branch list on screen, so controls
  // that filter the branch list should follow suit.
  const branchNavigatorVisible = compact ? !branchWorkspaceActive : !workspaceFocused
  return {
    mode: singlePane ? 'single-pane' : 'split',
    singlePane,
    compact,
    workspaceFocused,
    branchNavigatorCollapsed,
    branchNavigatorVisible,
  }
}
