import {
  isWorkspacePaneBranchTabType,
  isWorkspacePaneTabType,
  type WorkspacePaneBranchTabType,
  type WorkspacePaneTabType,
  type WorkspacePaneTabScope,
  workspacePaneTabRequiresWorktree as sharedWorkspacePaneTabRequiresWorktree,
  workspacePaneTabScope as sharedWorkspacePaneTabScope,
} from '#/shared/workspace-pane.ts'
import { workspacePaneTabProvider } from '#/web/components/workspace-pane/tab-providers.ts'

export type BranchLevelWorkspacePaneTab = WorkspacePaneBranchTabType
export type WorktreeLevelWorkspacePaneTab = Exclude<WorkspacePaneTabType, BranchLevelWorkspacePaneTab>

export function isWorkspacePaneTab(value: string | null | undefined): value is WorkspacePaneTabType {
  return isWorkspacePaneTabType(value)
}

export function workspacePaneTabScope(tab: WorkspacePaneTabType): WorkspacePaneTabScope {
  return sharedWorkspacePaneTabScope(tab)
}

export function isBranchLevelWorkspacePaneTab(tab: WorkspacePaneTabType): tab is BranchLevelWorkspacePaneTab {
  return isWorkspacePaneBranchTabType(tab)
}

export function isWorktreeLevelWorkspacePaneTab(tab: WorkspacePaneTabType): tab is WorktreeLevelWorkspacePaneTab {
  return workspacePaneTabScope(tab) === 'worktree'
}

export function workspacePaneTabRequiresWorktree(tab: WorkspacePaneTabType): boolean {
  return sharedWorkspacePaneTabRequiresWorktree(tab)
}

/**
 * The runtime truth that determines whether a preferred workspace pane tab
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
  /** Whether the terminal session projection has finished its first sync. */
  terminalSyncReady: boolean
}

/**
 * Resolve whether the stored preferred tab can still be considered as the
 * current selection. This never substitutes another tab: unavailable tabs
 * resolve to null, and the tab projection decides whether a matching tab
 * actually exists.
 */
export function resolveRenderableWorkspacePaneTab(
  preferred: WorkspacePaneTabType,
  context: WorkspacePaneRenderabilityContext,
): WorkspacePaneTabType | null {
  return workspacePaneTabProvider(preferred).isRenderable(context) ? preferred : null
}
