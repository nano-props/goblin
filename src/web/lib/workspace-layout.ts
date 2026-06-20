import type { WorkspaceLayout } from '#/shared/workspace-layout.ts'
export type RepoWorkspaceMode = 'split' | 'focus'

export interface RepoWorkspaceBehavior {
  /** The actual rendered workspace layout mode after collapsing/focus rules
   *  are applied. Layout-specific UI placement should prefer this field. */
  mode: RepoWorkspaceMode
  /** The normalized focus-toggle preference/pressed state. */
  workspacePaneFocusMode: boolean
  branchListActionsVisible: boolean
  prTooltipSide: 'right' | 'bottom'
}

export function repoWorkspaceBehavior(
  _layout: WorkspaceLayout,
  workspacePaneFocusMode = false,
): RepoWorkspaceBehavior {
  const mode: RepoWorkspaceMode = workspacePaneFocusMode ? 'focus' : 'split'
  return {
    mode,
    workspacePaneFocusMode,
    branchListActionsVisible: mode !== 'focus',
    prTooltipSide: 'bottom',
  }
}
