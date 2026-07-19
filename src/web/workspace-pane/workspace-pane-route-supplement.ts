import { formatTerminalWorktreeKeyForPath } from '#/shared/terminal-worktree-key.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { WorkspacePaneRouteTarget } from '#/web/App.tsx'
import { readRepoBranchSnapshotQueryProjection } from '#/web/repo-branch-read-model.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { workspacePaneCommittedRuntimeTargetIsCurrent } from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import { requiredGitWorkspacePaneTabsTarget } from '#/shared/workspace-pane-tabs-target.ts'

export interface WorkspacePaneRouteSupplementTarget {
  workspaceId: WorkspaceId
  workspaceRuntimeId: string
  branchName: string
  worktreePath: string | null
}

export function commitWorkspacePaneRouteSupplement(
  target: WorkspacePaneRouteSupplementTarget,
  route: WorkspacePaneRouteTarget,
): boolean {
  const state = useWorkspacesStore.getState()
  const workspace = state.workspaces[target.workspaceId]
  if (!workspace || workspace.capability.kind !== 'git' || workspace.workspaceRuntimeId !== target.workspaceRuntimeId)
    return false
  const branchModel = readRepoBranchSnapshotQueryProjection(workspace)
  const branch = branchModel?.branches.find((candidate) => candidate.name === target.branchName)
  if (!branch || (branch.worktree?.path ?? null) !== target.worktreePath) return false
  state.setWorkspacePaneTab(
    target.workspaceId,
    target.branchName,
    route === null ? null : route.kind === 'static' ? route.tab : 'terminal',
  )
  if (route?.kind === 'terminal' && target.worktreePath) {
    state.setSelectedTerminal(
      formatTerminalWorktreeKeyForPath(target.workspaceId, target.worktreePath),
      route.terminalSessionId,
    )
  }
  return true
}

export function commitWorkspacePaneCommittedRuntimeRouteSupplement(
  target: WorkspacePaneRouteSupplementTarget,
  route: WorkspacePaneRouteTarget,
): boolean {
  if (!workspacePaneCommittedRuntimeTargetIsCurrent(target)) return false
  const state = useWorkspacesStore.getState()
  state.setWorkspacePaneTabForTarget(
    requiredGitWorkspacePaneTabsTarget(target.workspaceId, target.branchName, target.worktreePath),
    route === null ? null : route.kind === 'static' ? route.tab : 'terminal',
  )
  if (route?.kind === 'terminal' && target.worktreePath) {
    state.setSelectedTerminal(
      formatTerminalWorktreeKeyForPath(target.workspaceId, target.worktreePath),
      route.terminalSessionId,
    )
  }
  return true
}
