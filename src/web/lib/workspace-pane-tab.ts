import {
  isWorkspacePaneBranchTabType,
  isWorkspacePaneTabType,
  type WorkspacePaneBranchTabType,
  type WorkspacePaneTabType,
  type WorkspacePaneTabScope,
  workspacePaneTabRequiresWorktree as sharedWorkspacePaneViewRequiresWorktree,
  workspacePaneTabScope as sharedWorkspacePaneViewScope,
} from '#/shared/workspace-pane.ts'
import { workspacePaneTabProvider } from '#/web/components/workspace-pane/tab-providers.ts'

export type BranchLevelWorkspacePaneTab = WorkspacePaneBranchTabType
export type WorktreeLevelWorkspacePaneTab = Exclude<WorkspacePaneTabType, BranchLevelWorkspacePaneTab>

export function isWorkspacePaneTab(value: string | null | undefined): value is WorkspacePaneTabType {
  return isWorkspacePaneTabType(value)
}

export function workspacePaneTabScope(view: WorkspacePaneTabType): WorkspacePaneTabScope {
  return sharedWorkspacePaneViewScope(view)
}

export function isBranchLevelWorkspacePaneTab(view: WorkspacePaneTabType): view is BranchLevelWorkspacePaneTab {
  return isWorkspacePaneBranchTabType(view)
}

export function isWorktreeLevelWorkspacePaneTab(view: WorkspacePaneTabType): view is WorktreeLevelWorkspacePaneTab {
  return workspacePaneTabScope(view) === 'worktree'
}

export function workspacePaneTabRequiresWorktree(view: WorkspacePaneTabType): boolean {
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
export function resolveRenderableWorkspacePaneTab(
  preferred: WorkspacePaneTabType,
  context: WorkspacePaneRenderabilityContext,
): WorkspacePaneTabType | null {
  return workspacePaneTabProvider(preferred).isRenderable(context) ? preferred : null
}
