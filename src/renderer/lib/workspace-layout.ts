import { effectiveDetailCollapsed, workspaceLayoutAllowsDetailCollapse } from '#/shared/workspace-layout.ts'
import type { WorkspaceLayout } from '#/shared/workspace-layout.ts'

export type RepoWorkspaceMode = 'split' | 'collapsed' | 'focus'

export interface RepoWorkspaceBehavior {
  mode: RepoWorkspaceMode
  detailCollapsed: boolean
  detailCollapseAllowed: boolean
  detailFocusAllowed: boolean
  detailFocusMode: boolean
  branchListActionsVisible: boolean
  detailActionVariant: 'bar' | 'auto'
  prTooltipSide: 'right' | 'bottom'
}

const REPO_WORKSPACE_BEHAVIOR = {
  'top-bottom': {
    branchListActionsVisible: true,
    detailActionVariant: 'bar',
    prTooltipSide: 'right',
  },
  'left-right': {
    branchListActionsVisible: false,
    detailActionVariant: 'auto',
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
  return {
    ...REPO_WORKSPACE_BEHAVIOR[layout],
    mode,
    detailCollapseAllowed: workspaceLayoutAllowsDetailCollapse(layout),
    detailFocusAllowed,
    detailFocusMode: detailFocusModeEffective,
    detailCollapsed: detailCollapsedEffective,
  }
}
