import {
  isWorkspacePaneBranchViewType,
  isWorkspacePaneViewType,
  type WorkspacePaneBranchViewType,
  type WorkspacePaneView,
  type WorkspacePaneViewScope,
  workspacePaneViewRequiresWorktree as sharedWorkspacePaneViewRequiresWorktree,
  workspacePaneViewScope as sharedWorkspacePaneViewScope,
} from '#/shared/workspace-pane.ts'
import { workspacePaneTabProvider } from '#/web/workspace-pane/workspace-pane-tab-providers.ts'

export type BranchLevelWorkspacePaneView = WorkspacePaneBranchViewType
export type WorktreeLevelWorkspacePaneView = Exclude<WorkspacePaneView, BranchLevelWorkspacePaneView>

export function isWorkspacePaneView(value: string | null | undefined): value is WorkspacePaneView {
  return isWorkspacePaneViewType(value)
}

export function workspacePaneViewScope(view: WorkspacePaneView): WorkspacePaneViewScope {
  return sharedWorkspacePaneViewScope(view)
}

export function isBranchLevelWorkspacePaneView(view: WorkspacePaneView): view is BranchLevelWorkspacePaneView {
  return isWorkspacePaneBranchViewType(view)
}

export function isWorktreeLevelWorkspacePaneView(view: WorkspacePaneView): view is WorktreeLevelWorkspacePaneView {
  return workspacePaneViewScope(view) === 'worktree'
}

export function workspacePaneViewRequiresWorktree(view: WorkspacePaneView): boolean {
  return sharedWorkspacePaneViewRequiresWorktree(view)
}

/**
 * The runtime truth that determines whether a preferred workspace pane view
 * has a backing surface that can be rendered now.
 * Grouped into an object so callers can't accidentally swap two
 * booleans at the call site.
 */
export interface WorkspacePaneRenderabilityContext {
  /** Whether the selected branch has a worktree on disk. */
  hasWorktree: boolean
  /** Number of open terminal sessions for the worktree. */
  terminalSessionCount: number
  /** Whether a new terminal is queued and waiting for mount geometry. */
  terminalCreatePending?: boolean
  /** Whether the terminal session registry has finished its first sync. */
  terminalSyncReady: boolean
}

/**
 * Resolve whether the stored preferred view can still be considered as the
 * current selection. This never substitutes another tab: unavailable views
 * resolve to null, and the tab projection decides whether a matching tab
 * actually exists.
 */
export function resolveRenderableWorkspacePaneView(
  preferred: WorkspacePaneView,
  context: WorkspacePaneRenderabilityContext,
): WorkspacePaneView | null {
  return workspacePaneTabProvider(preferred).isRenderable(context) ? preferred : null
}
