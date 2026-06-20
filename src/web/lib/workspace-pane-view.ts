import type { WorkspacePaneView } from '#/shared/workspace-pane.ts'

export function isWorkspacePaneView(value: string | null | undefined): value is WorkspacePaneView {
  return value === 'status' || value === 'changes' || value === 'terminal'
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
 *  - `hasWorktree` describes whether the branch can host a terminal view
 *  - `terminalSessionCount` + `terminalSyncReady` come from the
 *    TerminalSessionRegistry (live terminal context)
 *
 * `syncReady` lets us avoid briefly flashing `status → terminal → status`
 * during boot: until the registry confirms the worktree truth, a
 * `terminal` preference is preserved. Once the first sync settles, an
 * empty worktree dismisses the `terminal` preference.
 *
 * Pure function so it can be unit-tested without React.
 */
export function computeEffectiveWorkspacePaneView(preferred: WorkspacePaneView, context: WorkspacePaneViewContext): WorkspacePaneView {
  if (!context.hasWorktree && preferred === 'terminal') return 'status'
  if (preferred !== 'terminal') return preferred
  if (!context.terminalSyncReady) return 'terminal'
  return context.terminalSessionCount > 0 || context.terminalPendingCreate ? 'terminal' : 'status'
}
