import { useMemo } from 'react'
import type { RepoWorkspaceRepo, CurrentRepoWorkspacePresentation } from '#/web/components/repo-workspace/model.ts'
import {
  createRepoWorkspaceTabModel,
  repoWorkspaceRuntimeTabSessionId,
  type RepoWorkspaceTabModel,
  type RepoWorkspaceTabModelInput,
} from '#/web/workspace-pane/repo-workspace-tab-model.ts'
import { preferredWorkspacePaneTabForTarget } from '#/web/stores/repos/workspace-pane-preferences.ts'
import {
  useWorkspacePaneTabsQuery,
  workspacePaneTabsForTargetFromQueryData,
} from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import {
  useWorkspacePaneRuntimeTabTargetProjection,
  type WorkspacePaneRuntimeTabTargetProjectionHookResult,
} from '#/web/workspace-pane/use-workspace-pane-runtime-tab-target-projection.ts'
import { useSyncWorkspacePaneRuntimeTabProviderSelection } from '#/web/workspace-pane/workspace-pane-runtime-tab-providers.ts'

export interface RepoWorkspaceTabModelInputState {
  input: RepoWorkspaceTabModelInput
  selectedSessionIdByRuntimeType: WorkspacePaneRuntimeTabTargetProjectionHookResult['selectedSessionIdByRuntimeType']
}

export function useRepoWorkspaceTabModel(
  repo: Pick<RepoWorkspaceRepo, 'id' | 'instanceId' | 'ui'>,
  detail: CurrentRepoWorkspacePresentation,
) {
  const { input, selectedSessionIdByRuntimeType } = useRepoWorkspaceTabModelInput(repo, detail)
  const model = useMemo(() => createRepoWorkspaceTabModel(input), [input])
  useSyncRepoWorkspaceRuntimeTabSelection(model, selectedSessionIdByRuntimeType)
  return model
}

/**
 * Reads repo and runtime-tab state and packages the pure tab-model input.
 * No writes happen here; this is the data boundary into the workspace pane tab
 * projection.
 */
export function useRepoWorkspaceTabModelInput(
  repo: Pick<RepoWorkspaceRepo, 'id' | 'instanceId' | 'ui'>,
  detail: CurrentRepoWorkspacePresentation,
): RepoWorkspaceTabModelInputState {
  const { branch } = detail
  const branchName = branch?.name ?? null
  const worktreePath = branch?.worktree?.path ?? null
  const runtimeProjection = useWorkspacePaneRuntimeTabTargetProjection({
    repoRoot: repo.id,
    repoInstanceId: repo.instanceId,
    worktreePath,
  })
  const workspacePaneTabsQuery = useWorkspacePaneTabsQuery(repo.id, repo.instanceId)

  const workspacePaneTabEntries = useMemo(
    () =>
      workspacePaneTabsForTargetFromQueryData(workspacePaneTabsQuery.data ?? [], {
        repoRoot: repo.id,
        branchName,
        worktreePath,
      }),
    [workspacePaneTabsQuery.data, repo.id, repo.instanceId, branchName, worktreePath],
  )

  const preferredTab = useMemo(
    () =>
      preferredWorkspacePaneTabForTarget(repo.ui, branchName ? { repoRoot: repo.id, branchName, worktreePath } : null),
    [repo.ui.preferredWorkspacePaneTabByTarget, repo.id, branchName, worktreePath],
  )

  const input = useMemo<RepoWorkspaceTabModelInput>(
    () => ({
      repoId: repo.id,
      branchName,
      worktreePath,
      preferredTab,
      tabEntries: workspacePaneTabEntries,
      runtimeTabViews: runtimeProjection.runtimeTabViews,
      runtimeTabStateByType: runtimeProjection.runtimeTabStateByType,
    }),
    [
      repo.id,
      branchName,
      worktreePath,
      preferredTab,
      workspacePaneTabEntries,
      runtimeProjection.runtimeTabViews,
      runtimeProjection.runtimeTabStateByType,
    ],
  )

  return useMemo(
    () => ({ input, selectedSessionIdByRuntimeType: runtimeProjection.selectedSessionIdByRuntimeType }),
    [input, runtimeProjection.selectedSessionIdByRuntimeType],
  )
}

/**
 * Mirrors the model's resolved active runtime selection into the backing runtime store. Keeping
 * this separate from input collection makes the single write-side effect in
 * the tab-model hook explicit.
 */
export function useSyncRepoWorkspaceRuntimeTabSelection(
  model: Pick<RepoWorkspaceTabModel, 'activeTab' | 'runtimeTabTargetKeyByType'>,
  selectedSessionIdByRuntimeType: WorkspacePaneRuntimeTabTargetProjectionHookResult['selectedSessionIdByRuntimeType'],
): void {
  const activeSessionIdByRuntimeType = useMemo(
    () => ({
      terminal: repoWorkspaceRuntimeTabSessionId(model.activeTab, 'terminal'),
    }),
    [model.activeTab],
  )
  useSyncWorkspacePaneRuntimeTabProviderSelection(
    {
      activeSessionIdByRuntimeType,
      runtimeTabTargetKeyByType: model.runtimeTabTargetKeyByType,
    },
    selectedSessionIdByRuntimeType,
  )
}
