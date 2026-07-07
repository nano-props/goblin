import {
  createRepoWorkspaceTabModel,
  repoWorkspaceTabModelBlocksTabInteraction,
  type RepoWorkspaceTabModel,
} from '#/web/components/repo-workspace/tab-model.ts'
import { preferredWorkspacePaneTabForTarget } from '#/web/stores/repos/workspace-pane-preferences.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { readWorkspacePaneTabsForTarget } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { readRepoBranchQueryProjection } from '#/web/repo-branch-read-model.ts'
import { readWorkspacePaneRuntimeTabTargetProjection } from '#/web/workspace-pane/workspace-pane-runtime-tab-target-projection.ts'

export type WorkspacePaneTabTargetResolution =
  | { kind: 'ready'; target: RepoWorkspaceTabModel }
  | { kind: 'missing' }
  | { kind: 'unavailable'; reason: 'branch-read-model-unavailable' }

export function workspacePaneTabTargetForBranch(repoId: string, branchName: string): RepoWorkspaceTabModel | null {
  const resolution = resolveWorkspacePaneTabTargetForBranch(repoId, branchName)
  return resolution.kind === 'ready' ? resolution.target : null
}

export function workspacePaneTabInteractionBlockedForBranch(repoId: string, branchName: string): boolean {
  const target = workspacePaneTabTargetForBranch(repoId, branchName)
  return target ? repoWorkspaceTabModelBlocksTabInteraction(target) : false
}

export function resolveWorkspacePaneTabTargetForBranch(
  repoId: string,
  branchName: string,
): WorkspacePaneTabTargetResolution {
  const state = useReposStore.getState()
  const repo = state.repos[repoId]
  if (!repo) return { kind: 'missing' }
  const branchModel = readRepoBranchQueryProjection(repo)
  if (!branchModel) return { kind: 'unavailable', reason: 'branch-read-model-unavailable' }
  const branch = branchModel.branches.find((candidate) => candidate.name === branchName)
  if (!branch) return { kind: 'missing' }
  const worktreePath = branch.worktree?.path ?? null
  const runtimeProjection = readWorkspacePaneRuntimeTabTargetProjection({
    repoRoot: repo.id,
    repoInstanceId: repo.instanceId,
    worktreePath,
  })
  return {
    kind: 'ready',
    target: createRepoWorkspaceTabModel({
      repoId,
      branchName,
      worktreePath,
      preferredTab: preferredWorkspacePaneTabForTarget(repo.ui, {
        repoRoot: repoId,
        branchName,
        worktreePath,
      }),
      tabEntries: readWorkspacePaneTabsForTarget({
        repoRoot: repoId,
        repoInstanceId: repo.instanceId,
        branchName,
        worktreePath,
      }),
      runtimeTabViews: runtimeProjection.runtimeTabViews,
      runtimeTabStateByType: runtimeProjection.runtimeTabStateByType,
    }),
  }
}
