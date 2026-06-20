import type { WorkspaceLayout } from '#/shared/workspace-layout.ts'
export type RepoWorkspaceMode = 'split' | 'single-pane'

export interface RepoWorkspaceBehavior {
  mode: RepoWorkspaceMode
  singlePane: boolean
  compact: boolean
  workspaceFocused: boolean
  branchListActionsVisible: boolean
  prTooltipSide: 'right' | 'bottom'
}

export function repoWorkspaceBehavior({
  layout: _layout,
  compact = false,
  workspaceFocused = false,
}: {
  layout: WorkspaceLayout
  compact?: boolean
  workspaceFocused?: boolean
}): RepoWorkspaceBehavior {
  const singlePane = compact || workspaceFocused
  return {
    mode: singlePane ? 'single-pane' : 'split',
    singlePane,
    compact,
    workspaceFocused,
    branchListActionsVisible: true,
    prTooltipSide: 'bottom',
  }
}
