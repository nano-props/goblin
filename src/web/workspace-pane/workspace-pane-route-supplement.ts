import type { BranchWorkspacePaneRouteTarget } from '#/web/App.tsx'
import { getRepoSnapshotQueryData } from '#/web/repo-query-cache.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import type { WorkspacePaneDestinationTargetLease } from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import { repoWorktreeForBranch } from '#/shared/git-types.ts'

type WorkspacePaneBranchRouteSupplementTarget = Extract<
  WorkspacePaneDestinationTargetLease,
  { routeTarget: { kind: 'git-branch' } }
>

export function commitWorkspacePaneRouteSupplement(
  target: WorkspacePaneBranchRouteSupplementTarget,
  route: BranchWorkspacePaneRouteTarget,
): boolean {
  const state = workspacesStore.getState()
  const { workspaceId, branchName } = target.routeTarget
  const workspace = state.workspaces[workspaceId]
  if (!workspace || workspace.capability.kind !== 'git' || workspace.workspaceRuntimeId !== target.workspaceRuntimeId)
    return false
  const branchModel = getRepoSnapshotQueryData(workspace.id, workspace.workspaceRuntimeId)
  const branch = branchModel?.branches.find((candidate) => candidate.name === branchName)
  if (!branchModel || !branch || repoWorktreeForBranch(branchModel.worktrees, branchName)) return false
  state.setWorkspacePaneTab(workspaceId, branchName, route?.tab ?? null)
  return true
}
