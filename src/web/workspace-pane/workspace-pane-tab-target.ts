import {
  createRepoWorkspaceTabModel,
  repoWorkspaceTabModelBlocksTabInteraction,
  type RepoWorkspaceTabModel,
} from '#/web/workspace-pane/repo-workspace-tab-model.ts'
import type { RepoBranchWorkspacePaneRoute } from '#/web/App.tsx'
import { preferredWorkspacePaneTabForTarget } from '#/web/stores/repos/workspace-pane-preferences.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { readWorkspacePaneTabsForTarget } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { readRepoBranchQueryProjection } from '#/web/repo-branch-read-model.ts'
import { readWorkspacePaneRuntimeTabTargetProjection } from '#/web/workspace-pane/workspace-pane-runtime-tab-target-projection.ts'

export type WorkspacePaneTabTargetResolution =
  | { kind: 'ready'; target: RepoWorkspaceTabModel }
  | { kind: 'missing' }
  | { kind: 'unavailable'; reason: 'branch-read-model-unavailable' }

export interface WorkspacePaneTabTargetOptions {
  /**
   * `undefined` means no route context is available, so use persisted
   * workspace-pane preference. `null` is an explicit bare branch route and
   * therefore has no active pane tab.
   */
  workspacePaneRoute: RepoBranchWorkspacePaneRoute | null | undefined
}

export const workspacePanePreferenceTargetOptions: WorkspacePaneTabTargetOptions = { workspacePaneRoute: undefined }

export function workspacePaneTabTargetForBranch(
  repoId: string,
  branchName: string,
  options: WorkspacePaneTabTargetOptions,
): RepoWorkspaceTabModel | null {
  const resolution = resolveWorkspacePaneTabTargetForBranch(repoId, branchName, options)
  return resolution.kind === 'ready' ? resolution.target : null
}

export function workspacePaneTabInteractionBlockedForBranch(
  repoId: string,
  branchName: string,
  options: WorkspacePaneTabTargetOptions,
): boolean {
  const target = workspacePaneTabTargetForBranch(repoId, branchName, options)
  return target ? repoWorkspaceTabModelBlocksTabInteraction(target) : false
}

export function resolveWorkspacePaneTabTargetForBranch(
  repoId: string,
  branchName: string,
  options: WorkspacePaneTabTargetOptions,
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
      preferredTab: preferredWorkspacePaneTabForRoute(repo.ui, { repoRoot: repoId, branchName, worktreePath }, options),
      allowPreferredTabFallback: options.workspacePaneRoute === undefined,
      tabEntries: readWorkspacePaneTabsForTarget({
        repoRoot: repoId,
        repoInstanceId: repo.instanceId,
        branchName,
        worktreePath,
      }),
      runtimeTabViews: runtimeProjection.runtimeTabViews,
      runtimeTabStateByType: runtimeProjection.runtimeTabStateByType,
      requestedSessionIdByRuntimeType:
        options.workspacePaneRoute?.kind === 'terminal'
          ? { terminal: options.workspacePaneRoute.terminalSessionId }
          : undefined,
    }),
  }
}

function preferredWorkspacePaneTabForRoute(
  ui: Parameters<typeof preferredWorkspacePaneTabForTarget>[0],
  target: Parameters<typeof preferredWorkspacePaneTabForTarget>[1],
  options: WorkspacePaneTabTargetOptions,
) {
  const route = options.workspacePaneRoute
  if (route === undefined) return preferredWorkspacePaneTabForTarget(ui, target)
  if (route === null) return null
  if (route.kind === 'static') return route.tab
  if (route.kind === 'terminal') return 'terminal'
  return null
}
