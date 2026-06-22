import {
  isWorkspacePaneBranchViewType,
  isWorkspacePaneViewType,
  type WorkspacePaneBranchViewType,
  type WorkspacePaneView,
} from '#/shared/workspace-pane.ts'

export type WorkspacePaneViewScope = 'branch' | 'worktree'
export type BranchLevelWorkspacePaneView = WorkspacePaneBranchViewType
export type WorktreeLevelWorkspacePaneView = Exclude<WorkspacePaneView, BranchLevelWorkspacePaneView>

export function isWorkspacePaneView(value: string | null | undefined): value is WorkspacePaneView {
  return isWorkspacePaneViewType(value)
}

export function workspacePaneViewScope(view: WorkspacePaneView): WorkspacePaneViewScope {
  return isWorkspacePaneBranchViewType(view) ? 'branch' : 'worktree'
}

export function isBranchLevelWorkspacePaneView(view: WorkspacePaneView): view is BranchLevelWorkspacePaneView {
  return isWorkspacePaneBranchViewType(view)
}

export function isWorktreeLevelWorkspacePaneView(view: WorkspacePaneView): view is WorktreeLevelWorkspacePaneView {
  return workspacePaneViewScope(view) === 'worktree'
}

export function workspacePaneViewRequiresWorktree(view: WorkspacePaneView): boolean {
  return workspacePaneViewScope(view) === 'worktree'
}

/**
 * The runtime truth that determines which workspace pane view is renderable.
 * Grouped into an object so callers can't accidentally swap two
 * booleans at the call site.
 */
export interface WorkspacePaneViewContext {
  /** Whether the selected branch has a worktree on disk. */
  hasWorktree: boolean
  /** Number of open terminal sessions for the worktree. */
  terminalSessionCount: number
  /** Whether a new terminal is queued and waiting for mount geometry. */
  pendingCreate?: boolean
  /** Whether the terminal session registry has finished its first sync. */
  terminalSyncReady: boolean
}

/**
 * Resolve whether the stored preferred view can still be considered as the
 * current selection. This never substitutes another tab: unavailable views
 * resolve to null, and the tab projection decides whether a matching tab
 * actually exists.
 */
export function resolveWorkspacePaneSelectionView(
  preferred: WorkspacePaneView,
  context: WorkspacePaneViewContext,
): WorkspacePaneView | null {
  if (!context.hasWorktree && workspacePaneViewRequiresWorktree(preferred)) return null
  if (preferred !== 'terminal') return preferred
  if (!context.terminalSyncReady || context.pendingCreate) return 'terminal'
  return context.terminalSessionCount > 0 ? 'terminal' : null
}
