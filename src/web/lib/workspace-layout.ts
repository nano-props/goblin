import { effectiveDetailCollapsed, workspaceLayoutAllowsDetailCollapse } from '#/shared/workspace-layout.ts'
import type { WorkspaceLayout } from '#/shared/workspace-layout.ts'
export type RepoWorkspaceMode = 'split' | 'collapsed' | 'focus'

export interface RepoWorkspaceBehavior {
  /** The actual rendered workspace layout mode after collapsing/focus rules
   *  are applied. Layout-specific UI placement should prefer this field. */
  mode: RepoWorkspaceMode
  detailCollapsed: boolean
  detailCollapseAllowed: boolean
  detailFocusAllowed: boolean
  /** The normalized focus-toggle preference/pressed state for top-bottom
   *  layouts. This can stay true while `mode` is `collapsed`, so callers
   *  should not treat it as proof that the workspace is currently rendering
   *  in focus mode. */
  detailFocusMode: boolean
  branchListActionsVisible: boolean
  prTooltipSide: 'right' | 'bottom'
}

const REPO_WORKSPACE_BEHAVIOR = {
  'top-bottom': {
    branchListActionsVisible: true,
    prTooltipSide: 'right',
  },
  'left-right': {
    branchListActionsVisible: true,
    prTooltipSide: 'bottom',
  },
} satisfies Record<
  WorkspaceLayout,
  Omit<
    RepoWorkspaceBehavior,
    'detailCollapsed' | 'detailCollapseAllowed' | 'detailFocusAllowed' | 'detailFocusMode' | 'mode'
  >
>

export function repoWorkspaceBehavior(
  layout: WorkspaceLayout,
  detailCollapsed: boolean,
  detailFocusMode = false,
): RepoWorkspaceBehavior {
  const detailCollapsedEffective = effectiveDetailCollapsed(layout, detailCollapsed)
  const detailFocusAllowed = layout === 'top-bottom'
  const detailFocusModeEffective = detailFocusAllowed && detailFocusMode
  const mode: RepoWorkspaceMode = detailCollapsedEffective ? 'collapsed' : detailFocusModeEffective ? 'focus' : 'split'
  const baseBehavior = REPO_WORKSPACE_BEHAVIOR[layout]
  return {
    ...baseBehavior,
    mode,
    detailCollapseAllowed: workspaceLayoutAllowsDetailCollapse(layout),
    detailFocusAllowed,
    detailFocusMode: detailFocusModeEffective,
    detailCollapsed: detailCollapsedEffective,
    branchListActionsVisible: baseBehavior.branchListActionsVisible && mode !== 'focus',
  }
}
