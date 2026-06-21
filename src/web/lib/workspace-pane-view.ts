import type { WorkspacePaneView } from '#/shared/workspace-pane.ts'

export type WorkspacePaneViewScope = 'branch' | 'worktree'
export type BranchLevelWorkspacePaneView = Extract<WorkspacePaneView, 'status' | 'history'>
export type WorktreeLevelWorkspacePaneView = Exclude<WorkspacePaneView, BranchLevelWorkspacePaneView>

const WORKSPACE_PANE_VIEW_SCOPE: Record<WorkspacePaneView, WorkspacePaneViewScope> = {
  status: 'branch',
  changes: 'worktree',
  history: 'branch',
  terminal: 'worktree',
}

const WORKSPACE_PANE_VIEW_REQUIRES_WORKTREE: Record<WorkspacePaneView, boolean> = {
  status: false,
  changes: true,
  history: false,
  terminal: true,
}

export function isWorkspacePaneView(value: string | null | undefined): value is WorkspacePaneView {
  return value === 'status' || value === 'changes' || value === 'history' || value === 'terminal'
}

export function workspacePaneViewScope(view: WorkspacePaneView): WorkspacePaneViewScope {
  return WORKSPACE_PANE_VIEW_SCOPE[view]
}

export function isBranchLevelWorkspacePaneView(view: WorkspacePaneView): view is BranchLevelWorkspacePaneView {
  return workspacePaneViewScope(view) === 'branch'
}

export function isWorktreeLevelWorkspacePaneView(view: WorkspacePaneView): view is WorktreeLevelWorkspacePaneView {
  return workspacePaneViewScope(view) === 'worktree'
}

export function workspacePaneViewRequiresWorktree(view: WorkspacePaneView): boolean {
  return WORKSPACE_PANE_VIEW_REQUIRES_WORKTREE[view]
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
  /** Whether the terminal session registry has finished its first sync. */
  terminalSyncReady: boolean
  /** True while a `create terminal` IPC is in flight. */
  terminalPendingCreate?: boolean
}

/**
 * Resolve the workspace pane view the UI should actually render.
 *
 * The repos store holds the user's preferred view (the persisted intent).
 * Whether that preference is renderable depends on the live context:
 *  - `hasWorktree` describes whether the branch can host worktree-scoped views
 *  - `terminalSessionCount` + `terminalSyncReady` come from the
 *    TerminalSessionRegistry (live terminal context)
 *
 * `syncReady` lets us avoid briefly flashing `status → terminal → status`
 * during boot: until the registry confirms the worktree truth, a
 * `terminal` preference is preserved. Once the first sync settles, an
 * empty worktree dismisses the `terminal` preference.
 *
 * A branch without a worktree still has branch-level status, but no
 * worktree-scoped changes or terminal view; those preferences resolve to
 * `status` at render time.
 *
 * Pure function so it can be unit-tested without React.
 */
export function computeEffectiveWorkspacePaneView(
  preferred: WorkspacePaneView,
  context: WorkspacePaneViewContext,
): WorkspacePaneView {
  if (!context.hasWorktree && workspacePaneViewRequiresWorktree(preferred)) return 'status'
  if (preferred !== 'terminal') return preferred
  if (!context.terminalSyncReady) return 'terminal'
  return context.terminalSessionCount > 0 || context.terminalPendingCreate ? 'terminal' : 'status'
}
