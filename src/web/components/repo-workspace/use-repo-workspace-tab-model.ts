import { useMemo } from 'react'
import type { RepoWorkspaceRepo, CurrentRepoWorkspacePresentation } from '#/web/components/repo-workspace/model.ts'
import type { ParsedWorkspacePaneRoute } from '#/web/App.tsx'
import {
  createRepoWorkspaceTabModel,
  repoWorkspaceTabModelBlocksTabInteraction,
  repoWorkspaceRuntimeTabSessionId,
  type RepoWorkspaceTabEntriesProjectionPhase,
  type RepoWorkspaceTabModel,
  type RepoWorkspaceTabModelInput,
} from '#/web/workspace-pane/repo-workspace-tab-model.ts'
import { preferredWorkspacePaneTabForTarget } from '#/web/stores/workspaces/workspace-pane-preferences.ts'
import {
  useWorkspacePaneTabsQuery,
  workspacePaneTabsForTargetFromQueryData,
} from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { useWorkspacePaneRuntimeTabTargetProjection } from '#/web/workspace-pane/use-workspace-pane-runtime-tab-target-projection.ts'
import { useSyncWorkspacePaneRuntimeTabProviderSelection } from '#/web/workspace-pane/workspace-pane-runtime-tab-providers.ts'
import { requiredGitWorkspacePaneTabsTarget } from '#/shared/workspace-pane-tabs-target.ts'
import type { WorkspacePaneTabsTarget } from '#/shared/workspace-pane-tabs-target.ts'
import type { WorkspacePaneTabType } from '#/shared/workspace-pane.ts'
import type { GitHead } from '#/shared/git-head.ts'

export function useRepoWorkspaceTabModel(
  repo: Pick<RepoWorkspaceRepo, 'id' | 'workspaceRuntimeId' | 'ui'>,
  detail: CurrentRepoWorkspacePresentation,
  workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined,
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
  repo: Pick<RepoWorkspaceRepo, 'id' | 'workspaceRuntimeId' | 'ui'>,
  detail: CurrentRepoWorkspacePresentation,
  workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined,
): RepoWorkspaceTabModelInput {
  const { branch } = detail
  const branchName = branch?.name ?? null
  const worktreePath = branch?.worktree?.path ?? null
  const runtimeProjection = useWorkspacePaneRuntimeTabTargetProjection({
    workspaceId: repo.id,
    workspaceRuntimeId: repo.workspaceRuntimeId,
    worktreePath,
  })
  const workspacePaneTabsQuery = useWorkspacePaneTabsQuery(repo.id, repo.workspaceRuntimeId)
  const requestedSessionIdByRuntimeType = useMemo(
    () => (workspacePaneRoute?.kind === 'terminal' ? { terminal: workspacePaneRoute.terminalSessionId } : undefined),
    [workspacePaneRoute],
  )

  const workspacePaneTabEntries = useMemo(
    () =>
      workspacePaneTabsForTargetFromQueryData(
        workspacePaneTabsQuery.data ?? { revision: 0, entries: [] },
        branchName
          ? requiredGitWorkspacePaneTabsTarget(repo.id, branchName, worktreePath)
          : { kind: 'inactive', workspaceId: repo.id, branchName: null, worktreePath: null },
      ),
    [workspacePaneTabsQuery.data, repo.id, repo.workspaceRuntimeId, branchName, worktreePath],
  )

  const preferredTab = useMemo(() => {
    if (workspacePaneRoute === null) return null
    if (workspacePaneRoute?.kind === 'static') return workspacePaneRoute.tab
    if (workspacePaneRoute?.kind === 'terminal') return 'terminal'
    if (workspacePaneRoute?.kind === 'invalid-static') return null
    return preferredWorkspacePaneTabForTarget(
      repo.ui,
      branchName ? requiredGitWorkspacePaneTabsTarget(repo.id, branchName, worktreePath) : null,
    )
  }, [repo.ui.preferredWorkspacePaneTabByTarget, repo.id, branchName, worktreePath, workspacePaneRoute])

  const input = useMemo<RepoWorkspaceTabModelInput>(
    () => ({
      workspaceId: repo.id,
      workspaceRuntimeId: repo.workspaceRuntimeId,
      paneTarget: branchName
        ? requiredGitWorkspacePaneTabsTarget(repo.id, branchName, worktreePath)
        : { kind: 'inactive', workspaceId: repo.id },
      worktreeHead: branchName && worktreePath ? { kind: 'branch', branchName } : undefined,
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
      repo.workspaceRuntimeId,
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
  repo: Pick<RepoWorkspaceRepo, 'id' | 'workspaceRuntimeId' | 'ui'>,
): RepoWorkspaceTabModel {
  const runtimeProjection = useWorkspacePaneRuntimeTabTargetProjection({
    workspaceId: repo.id,
    workspaceRuntimeId: repo.workspaceRuntimeId,
    worktreePath: repo.id,
  })
  const tabsQuery = useWorkspacePaneTabsQuery(repo.id, repo.workspaceRuntimeId)
  const target = useMemo(() => ({ kind: 'workspace-root' as const, workspaceId: repo.id }), [repo.id])
  const tabEntries = useMemo(
    () => workspacePaneTabsForTargetFromQueryData(tabsQuery.data ?? { revision: 0, entries: [] }, target),
    [tabsQuery.data, target],
  )
  const preferredTab =
    tabEntries.length > 0 ? (preferredWorkspacePaneTabForTarget(repo.ui, target) ?? tabEntries[0]!.type) : null
  const input = useMemo<RepoWorkspaceTabModelInput>(
    () => ({
      workspaceId: repo.id,
      workspaceRuntimeId: repo.workspaceRuntimeId,
      paneTarget: target,
      preferredTab,
      tabEntries,
      tabEntriesProjectionPhase: workspacePaneTabsProjectionPhase(tabsQuery.status),
      runtimeTabViews: runtimeProjection.runtimeTabViews,
      runtimeTabStateByType: runtimeProjection.runtimeTabStateByType,
    }),
    [
      preferredTab,
      repo.id,
      repo.workspaceRuntimeId,
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

export function useFilesystemWorkspaceTabModel(
  repo: Pick<RepoWorkspaceRepo, 'id' | 'workspaceRuntimeId' | 'ui'>,
  target: WorkspacePaneTabsTarget,
  worktreeHead: GitHead,
  worktreePath: string,
  requestedTab: WorkspacePaneTabType | null,
  requestedSessionId: string | null,
): RepoWorkspaceTabModel {
  const runtimeProjection = useWorkspacePaneRuntimeTabTargetProjection({
    workspaceId: repo.id,
    workspaceRuntimeId: repo.workspaceRuntimeId,
    worktreePath,
  })
  const tabsQuery = useWorkspacePaneTabsQuery(repo.id, repo.workspaceRuntimeId)
  const tabEntries = useMemo(
    () => workspacePaneTabsForTargetFromQueryData(tabsQuery.data ?? { revision: 0, entries: [] }, target),
    [tabsQuery.data, target],
  )
  const preferredTab = requestedTab
    ? requestedTab
    : tabEntries.length > 0
      ? (preferredWorkspacePaneTabForTarget(repo.ui, target) ?? tabEntries[0]!.type)
      : null
  const input = useMemo<RepoWorkspaceTabModelInput>(
    () => ({
      workspaceId: repo.id,
      workspaceRuntimeId: repo.workspaceRuntimeId,
      paneTarget: target,
      worktreeHead: target.kind === 'git-worktree' ? worktreeHead : undefined,
      preferredTab,
      tabEntries,
      tabEntriesProjectionPhase: workspacePaneTabsProjectionPhase(tabsQuery.status),
      runtimeTabViews: runtimeProjection.runtimeTabViews,
      runtimeTabStateByType: runtimeProjection.runtimeTabStateByType,
      requestedSessionIdByRuntimeType: requestedSessionId ? { terminal: requestedSessionId } : undefined,
    }),
    [
      preferredTab,
      repo.id,
      repo.workspaceRuntimeId,
      requestedSessionId,
      requestedTab,
      runtimeProjection.runtimeTabStateByType,
      runtimeProjection.runtimeTabViews,
      tabEntries,
      tabsQuery.status,
      target,
      worktreeHead,
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
