import { useMemo } from 'react'
import type { RepoWorkspaceRepo, CurrentRepoWorkspacePresentation } from '#/web/components/repo-workspace/model.ts'
import type { ParsedRepoBranchWorkspacePaneRoute } from '#/web/App.tsx'
import {
  createRepoWorkspaceTabModel,
  repoWorkspaceTabModelBlocksTabInteraction,
  repoWorkspaceRuntimeTabSessionId,
  type RepoWorkspaceTabEntriesProjectionPhase,
  type RepoWorkspaceTabModel,
  type RepoWorkspaceTabModelInput,
} from '#/web/workspace-pane/repo-workspace-tab-model.ts'
import { preferredWorkspacePaneTabForTarget } from '#/web/stores/repos/workspace-pane-preferences.ts'
import {
  useWorkspacePaneTabsQuery,
  workspacePaneTabsForTargetFromQueryData,
} from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { useWorkspacePaneRuntimeTabTargetProjection } from '#/web/workspace-pane/use-workspace-pane-runtime-tab-target-projection.ts'
import { useSyncWorkspacePaneRuntimeTabProviderSelection } from '#/web/workspace-pane/workspace-pane-runtime-tab-providers.ts'

export function useRepoWorkspaceTabModel(
  repo: Pick<RepoWorkspaceRepo, 'id' | 'repoRuntimeId' | 'ui'>,
  detail: CurrentRepoWorkspacePresentation,
  workspacePaneRoute: ParsedRepoBranchWorkspacePaneRoute | null | undefined,
) {
  const input = useRepoWorkspaceTabModelInput(repo, detail, workspacePaneRoute)
  const model = useMemo(() => createRepoWorkspaceTabModel(input), [input])
  return model
}

/**
 * Reads repo and runtime-tab state and packages the pure tab-model input.
 * No writes happen here; this is the data boundary into the workspace pane tab
 * projection.
 */
export function useRepoWorkspaceTabModelInput(
  repo: Pick<RepoWorkspaceRepo, 'id' | 'repoRuntimeId' | 'ui'>,
  detail: CurrentRepoWorkspacePresentation,
  workspacePaneRoute: ParsedRepoBranchWorkspacePaneRoute | null | undefined,
): RepoWorkspaceTabModelInput {
  const { branch } = detail
  const branchName = branch?.name ?? null
  const worktreePath = branch?.worktree?.path ?? null
  const runtimeProjection = useWorkspacePaneRuntimeTabTargetProjection({
    repoRoot: repo.id,
    repoRuntimeId: repo.repoRuntimeId,
    worktreePath,
  })
  const workspacePaneTabsQuery = useWorkspacePaneTabsQuery(repo.id, repo.repoRuntimeId)
  const requestedSessionIdByRuntimeType = useMemo(
    () => (workspacePaneRoute?.kind === 'terminal' ? { terminal: workspacePaneRoute.terminalSessionId } : undefined),
    [workspacePaneRoute],
  )

  const workspacePaneTabEntries = useMemo(
    () =>
      workspacePaneTabsForTargetFromQueryData(
        workspacePaneTabsQuery.data ?? { revision: 0, entries: [] },
        branchName
          ? { repoRoot: repo.id, branchName, worktreePath }
          : { kind: 'inactive', repoRoot: repo.id, branchName: null, worktreePath: null },
      ),
    [workspacePaneTabsQuery.data, repo.id, repo.repoRuntimeId, branchName, worktreePath],
  )

  const preferredTab = useMemo(() => {
    if (workspacePaneRoute === null) return null
    if (workspacePaneRoute?.kind === 'static') return workspacePaneRoute.tab
    if (workspacePaneRoute?.kind === 'terminal') return 'terminal'
    if (workspacePaneRoute?.kind === 'invalid-static') return null
    return preferredWorkspacePaneTabForTarget(
      repo.ui,
      branchName ? { repoRoot: repo.id, branchName, worktreePath } : null,
    )
  }, [repo.ui.preferredWorkspacePaneTabByTarget, repo.id, branchName, worktreePath, workspacePaneRoute])

  const input = useMemo<RepoWorkspaceTabModelInput>(
    () => ({
      repoId: repo.id,
      repoRuntimeId: repo.repoRuntimeId,
      branchName,
      worktreePath,
      preferredTab,
      allowPreferredTabFallback: workspacePaneRoute === undefined,
      tabEntries: workspacePaneTabEntries,
      tabEntriesProjectionPhase: workspacePaneTabsProjectionPhase(workspacePaneTabsQuery.status),
      runtimeTabViews: runtimeProjection.runtimeTabViews,
      runtimeTabStateByType: runtimeProjection.runtimeTabStateByType,
      requestedSessionIdByRuntimeType,
    }),
    [
      repo.id,
      repo.repoRuntimeId,
      branchName,
      worktreePath,
      preferredTab,
      workspacePaneTabsQuery.status,
      workspacePaneTabEntries,
      runtimeProjection.runtimeTabViews,
      runtimeProjection.runtimeTabStateByType,
      requestedSessionIdByRuntimeType,
      workspacePaneRoute,
    ],
  )

  return input
}

export function useWorkspaceRootTabModel(
  repo: Pick<RepoWorkspaceRepo, 'id' | 'repoRuntimeId' | 'ui'>,
): RepoWorkspaceTabModel {
  const runtimeProjection = useWorkspacePaneRuntimeTabTargetProjection({
    repoRoot: repo.id,
    repoRuntimeId: repo.repoRuntimeId,
    worktreePath: repo.id,
  })
  const tabsQuery = useWorkspacePaneTabsQuery(repo.id, repo.repoRuntimeId)
  const target = useMemo(
    () => ({ kind: 'workspace-root' as const, repoRoot: repo.id, branchName: null, worktreePath: null }),
    [repo.id],
  )
  const tabEntries = useMemo(
    () => workspacePaneTabsForTargetFromQueryData(tabsQuery.data ?? { revision: 0, entries: [] }, target),
    [tabsQuery.data, target],
  )
  const preferredTab = preferredWorkspacePaneTabForTarget(repo.ui, target) ?? 'status'
  const input = useMemo<RepoWorkspaceTabModelInput>(
    () => ({
      repoId: repo.id,
      repoRuntimeId: repo.repoRuntimeId,
      branchName: null,
      worktreePath: repo.id,
      preferredTab,
      tabEntries,
      tabEntriesProjectionPhase: workspacePaneTabsProjectionPhase(tabsQuery.status),
      runtimeTabViews: runtimeProjection.runtimeTabViews,
      runtimeTabStateByType: runtimeProjection.runtimeTabStateByType,
    }),
    [
      preferredTab,
      repo.id,
      repo.repoRuntimeId,
      runtimeProjection.runtimeTabStateByType,
      runtimeProjection.runtimeTabViews,
      tabEntries,
      tabsQuery.status,
    ],
  )
  const model = useMemo(() => createRepoWorkspaceTabModel(input), [input])
  useSyncRepoWorkspaceRuntimeTabSelection(model, { enabled: true })
  return model
}

function workspacePaneTabsProjectionPhase(
  status: ReturnType<typeof useWorkspacePaneTabsQuery>['status'],
): RepoWorkspaceTabEntriesProjectionPhase {
  if (status === 'success') return 'ready'
  if (status === 'error') return 'failed'
  return 'pending'
}

/**
 * Mirrors the verified model's resolved active runtime selection into the
 * backing runtime store. The caller owns the route/reconciliation boundary;
 * this hook only performs the provider write once that boundary allows it.
 */
export function useSyncRepoWorkspaceRuntimeTabSelection(
  model: Pick<RepoWorkspaceTabModel, 'activeTab' | 'runtimeTabTargetKeyByType' | 'runtimeTabStateByType'>,
  options: { enabled: boolean },
): void {
  const tabInteractionBlocked = !options.enabled || repoWorkspaceTabModelBlocksTabInteraction(model)
  const activeSessionIdByRuntimeType = useMemo(
    () => ({
      terminal: tabInteractionBlocked ? null : repoWorkspaceRuntimeTabSessionId(model.activeTab, 'terminal'),
    }),
    [model.activeTab, tabInteractionBlocked],
  )
  const selectedSessionIdByRuntimeType = useMemo(
    () => ({
      terminal: model.runtimeTabStateByType.terminal.selectedSessionId,
    }),
    [model.runtimeTabStateByType],
  )
  useSyncWorkspacePaneRuntimeTabProviderSelection(
    {
      activeSessionIdByRuntimeType,
      runtimeTabTargetKeyByType: model.runtimeTabTargetKeyByType,
    },
    selectedSessionIdByRuntimeType,
  )
}
