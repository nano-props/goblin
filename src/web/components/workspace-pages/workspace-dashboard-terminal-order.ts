import type { RepoWorktreeSnapshot } from '#/shared/git-types.ts'
import type { WorkspacePaneTabsSnapshot } from '#/shared/workspace-pane-tabs.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { orderWorkspaceTerminals } from '#/shared/workspace-terminal-order.ts'
import type { WorkspaceTerminalSessionSummary } from '#/web/terminal/components/types.ts'

interface WorkspaceDashboardTerminalOrderInput {
  workspaceId: WorkspaceId
  sessions: readonly WorkspaceTerminalSessionSummary[]
  worktrees: readonly RepoWorktreeSnapshot[]
  paneTabs: WorkspacePaneTabsSnapshot | undefined
}

/**
 * Dashboard order is a read-only composition of the repository branch order,
 * canonical pane-tab order, and live terminal authority. Missing projections
 * retain their incoming order and never hide an established terminal session.
 */
export function orderWorkspaceDashboardTerminals(
  input: WorkspaceDashboardTerminalOrderInput,
): WorkspaceTerminalSessionSummary[] {
  return orderWorkspaceTerminals({
    ...input,
    terminalSessionId: (session) => session.terminalSessionId,
    target: (session) => session.base.target,
  })
}
