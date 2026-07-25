import { useMemo } from 'react'
import type {
  CurrentGitWorkspacePanePresentation,
  GitWorkspacePaneProjection,
} from '#/web/components/repo-workspace/model.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { WorkspaceUiState } from '#/web/stores/workspaces/types.ts'
import type { ParsedWorkspacePaneRoute } from '#/web/App.tsx'
import {
  createWorkspacePaneTabModel,
  workspacePaneTabModelBlocksTabInteraction,
  materializedWorkspacePaneRuntimeTabSessionId,
  type WorkspacePaneTabEntriesProjectionPhase,
  type WorkspacePaneTabModel,
  type WorkspacePaneTabModelInput,
} from '#/web/workspace-pane/workspace-pane-tab-model.ts'
import { preferredWorkspacePaneTabForTarget } from '#/web/stores/workspaces/workspace-pane-preferences.ts'
import {
  useWorkspacePaneTabsQuery,
  workspacePaneTabsForTargetFromQueryData,
} from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { useWorkspacePaneRuntimeTabTargetProjection } from '#/web/workspace-pane/use-workspace-pane-runtime-tab-target-projection.ts'
import { useSyncWorkspacePaneRuntimeTabProviderSelection } from '#/web/workspace-pane/workspace-pane-runtime-tab-providers.ts'
import { requiredGitWorkspacePaneTabsTarget } from '#/shared/workspace-pane-tabs-target.ts'
import type { GitWorktreeWorkspacePaneTabsTarget } from '#/shared/workspace-pane-tabs-target.ts'
import type { WorkspacePaneTabType } from '#/shared/workspace-pane.ts'
import type { GitHead } from '#/shared/git-head.ts'
import {
  gitWorktreeFilesystemExecutionTarget,
  workspaceRootFilesystemExecutionTarget,
} from '#/shared/workspace-runtime.ts'

export interface WorkspacePaneModelWorkspace {
  id: WorkspaceId
  workspaceRuntimeId: string
  ui: Pick<WorkspaceUiState, 'preferredWorkspacePaneTabByTarget'>
}

export type WorkspacePaneRuntimeContext = Pick<WorkspacePaneModelWorkspace, 'workspaceRuntimeId' | 'ui'>

export function useGitWorkspacePaneTabModel(
  gitWorkspace: Pick<GitWorkspacePaneProjection, 'id' | 'workspaceRuntimeId' | 'ui'>,
  detail: CurrentGitWorkspacePanePresentation,
  workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined,
) {
  const input = useGitWorkspacePaneTabModelInput(gitWorkspace, detail, workspacePaneRoute)
  const model = useMemo(() => createWorkspacePaneTabModel(input), [input])
  return model
}

/**
 * Reads Git workspace and runtime-tab state and packages the pure tab-model input.
 * No writes happen here; this is the data boundary into the workspace pane tab
 * projection.
 */
export function useGitWorkspacePaneTabModelInput(
  gitWorkspace: Pick<GitWorkspacePaneProjection, 'id' | 'workspaceRuntimeId' | 'ui'>,
  detail: CurrentGitWorkspacePanePresentation,
  workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined,
): WorkspacePaneTabModelInput {
  const { branch } = detail
  const branchName = branch?.name ?? null
  const worktreePath = branch?.worktree?.path ?? null
  const runtimeProjection = useWorkspacePaneRuntimeTabTargetProjection({
    workspaceId: gitWorkspace.id,
    workspaceRuntimeId: gitWorkspace.workspaceRuntimeId,
    filesystemTarget: worktreePath
      ? gitWorktreeFilesystemExecutionTarget(gitWorkspace.id, gitWorkspace.workspaceRuntimeId, worktreePath)
      : null,
  })
  const workspacePaneTabsQuery = useWorkspacePaneTabsQuery(gitWorkspace.id, gitWorkspace.workspaceRuntimeId)
  const requestedSessionIdByRuntimeType = useMemo(
    () => (workspacePaneRoute?.kind === 'terminal' ? { terminal: workspacePaneRoute.terminalSessionId } : undefined),
    [workspacePaneRoute],
  )

  const workspacePaneTabEntries = useMemo(
    () =>
      workspacePaneTabsForTargetFromQueryData(
        workspacePaneTabsQuery.data ?? { revision: 0, entries: [] },
        branchName
          ? requiredGitWorkspacePaneTabsTarget(gitWorkspace.id, branchName, worktreePath)
          : { kind: 'inactive', workspaceId: gitWorkspace.id, branchName: null, worktreePath: null },
      ),
    [workspacePaneTabsQuery.data, gitWorkspace.id, branchName, worktreePath],
  )

  const preferredTab = useMemo(() => {
    if (workspacePaneRoute?.kind === 'static') return workspacePaneRoute.tab
    if (workspacePaneRoute?.kind === 'terminal') return 'terminal'
    if (workspacePaneRoute?.kind === 'invalid-static') return null
    if (workspacePaneRoute === null) return null
    return (
      preferredWorkspacePaneTabForTarget(
        gitWorkspace.ui,
        branchName ? requiredGitWorkspacePaneTabsTarget(gitWorkspace.id, branchName, worktreePath) : null,
      ) ??
      workspacePaneTabEntries[0]?.type ??
      null
    )
  }, [gitWorkspace.ui, gitWorkspace.id, branchName, worktreePath, workspacePaneRoute, workspacePaneTabEntries])

  const input = useMemo<WorkspacePaneTabModelInput>(
    () => ({
      workspaceId: gitWorkspace.id,
      workspaceRuntimeId: gitWorkspace.workspaceRuntimeId,
      routeTarget: branchName
        ? { kind: 'git-branch', workspaceId: gitWorkspace.id, branchName }
        : { kind: 'inactive', workspaceId: gitWorkspace.id },
      paneTarget: branchName
        ? requiredGitWorkspacePaneTabsTarget(gitWorkspace.id, branchName, worktreePath)
        : { kind: 'inactive', workspaceId: gitWorkspace.id },
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
      gitWorkspace.id,
      gitWorkspace.workspaceRuntimeId,
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
  workspace: WorkspacePaneModelWorkspace,
  workspacePaneRoute: ParsedWorkspacePaneRoute | null,
): WorkspacePaneTabModel {
  const runtimeProjection = useWorkspacePaneRuntimeTabTargetProjection({
    workspaceId: workspace.id,
    workspaceRuntimeId: workspace.workspaceRuntimeId,
    filesystemTarget: workspaceRootFilesystemExecutionTarget(workspace.id, workspace.workspaceRuntimeId),
  })
  const tabsQuery = useWorkspacePaneTabsQuery(workspace.id, workspace.workspaceRuntimeId)
  const target = useMemo(() => ({ kind: 'workspace-root' as const, workspaceId: workspace.id }), [workspace.id])
  const tabEntries = useMemo(
    () => workspacePaneTabsForTargetFromQueryData(tabsQuery.data ?? { revision: 0, entries: [] }, target),
    [tabsQuery.data, target],
  )
  const requestedTab =
    workspacePaneRoute?.kind === 'terminal'
      ? 'terminal'
      : workspacePaneRoute?.kind === 'static'
        ? workspacePaneRoute.tab
        : null
  const requestedSessionId = workspacePaneRoute?.kind === 'terminal' ? workspacePaneRoute.terminalSessionId : null
  const preferredTab = workspacePaneRoute
    ? requestedTab
    : tabEntries.length > 0
      ? (preferredWorkspacePaneTabForTarget(workspace.ui, target) ?? tabEntries[0]!.type)
      : null
  const input = useMemo<WorkspacePaneTabModelInput>(
    () => ({
      workspaceId: workspace.id,
      workspaceRuntimeId: workspace.workspaceRuntimeId,
      routeTarget: target,
      paneTarget: target,
      preferredTab,
      allowPreferredTabFallback: workspacePaneRoute === null,
      tabEntries,
      tabEntriesProjectionPhase: workspacePaneTabsProjectionPhase(tabsQuery.status),
      runtimeTabViews: runtimeProjection.runtimeTabViews,
      runtimeTabStateByType: runtimeProjection.runtimeTabStateByType,
      requestedSessionIdByRuntimeType: requestedSessionId ? { terminal: requestedSessionId } : undefined,
    }),
    [
      preferredTab,
      requestedSessionId,
      workspace.id,
      workspace.workspaceRuntimeId,
      runtimeProjection.runtimeTabStateByType,
      runtimeProjection.runtimeTabViews,
      tabEntries,
      tabsQuery.status,
      workspacePaneRoute,
    ],
  )
  return useMemo(() => createWorkspacePaneTabModel(input), [input])
}

export function useGitWorktreeWorkspacePaneTabModel(
  workspaceRuntime: WorkspacePaneRuntimeContext,
  target: GitWorktreeWorkspacePaneTabsTarget,
  worktreeHead: GitHead,
  workspacePaneRoute: ParsedWorkspacePaneRoute | null,
): WorkspacePaneTabModel {
  const runtimeProjection = useWorkspacePaneRuntimeTabTargetProjection({
    workspaceId: target.workspaceId,
    workspaceRuntimeId: workspaceRuntime.workspaceRuntimeId,
    filesystemTarget: gitWorktreeFilesystemExecutionTarget(
      target.workspaceId,
      workspaceRuntime.workspaceRuntimeId,
      target.worktreePath,
    ),
  })
  const tabsQuery = useWorkspacePaneTabsQuery(target.workspaceId, workspaceRuntime.workspaceRuntimeId)
  const tabEntries = useMemo(
    () => workspacePaneTabsForTargetFromQueryData(tabsQuery.data ?? { revision: 0, entries: [] }, target),
    [tabsQuery.data, target],
  )
  const requestedTab =
    workspacePaneRoute?.kind === 'terminal'
      ? 'terminal'
      : workspacePaneRoute?.kind === 'static'
        ? workspacePaneRoute.tab
        : null
  const requestedSessionId = workspacePaneRoute?.kind === 'terminal' ? workspacePaneRoute.terminalSessionId : null
  const preferredTab = workspacePaneRoute
    ? requestedTab
    : tabEntries.length > 0
      ? (preferredWorkspacePaneTabForTarget(workspaceRuntime.ui, target) ?? tabEntries[0]!.type)
      : null
  const input = useMemo<WorkspacePaneTabModelInput>(
    () => ({
      workspaceId: target.workspaceId,
      workspaceRuntimeId: workspaceRuntime.workspaceRuntimeId,
      routeTarget: target,
      paneTarget: target,
      worktreeHead,
      preferredTab,
      allowPreferredTabFallback: workspacePaneRoute === null,
      tabEntries,
      tabEntriesProjectionPhase: workspacePaneTabsProjectionPhase(tabsQuery.status),
      runtimeTabViews: runtimeProjection.runtimeTabViews,
      runtimeTabStateByType: runtimeProjection.runtimeTabStateByType,
      requestedSessionIdByRuntimeType: requestedSessionId ? { terminal: requestedSessionId } : undefined,
    }),
    [
      preferredTab,
      workspaceRuntime.workspaceRuntimeId,
      requestedSessionId,
      runtimeProjection.runtimeTabStateByType,
      runtimeProjection.runtimeTabViews,
      tabEntries,
      tabsQuery.status,
      target,
      worktreeHead,
      workspacePaneRoute,
    ],
  )
  return useMemo(() => createWorkspacePaneTabModel(input), [input])
}

function workspacePaneTabsProjectionPhase(
  status: ReturnType<typeof useWorkspacePaneTabsQuery>['status'],
): WorkspacePaneTabEntriesProjectionPhase {
  if (status === 'success') return 'ready'
  if (status === 'error') return 'failed'
  return 'pending'
}

/**
 * Mirrors the verified model's resolved active runtime selection into the
 * backing runtime store. The caller owns the route/reconciliation boundary;
 * this hook only performs the provider write once that boundary allows it.
 */
export function useSyncWorkspacePaneRuntimeTabSelection(
  model: Pick<WorkspacePaneTabModel, 'activeTab' | 'runtimeTabTargetKeyByType' | 'runtimeTabStateByType'>,
  options: { enabled: boolean },
): void {
  const tabInteractionBlocked = !options.enabled || workspacePaneTabModelBlocksTabInteraction(model)
  const activeSessionIdByRuntimeType = useMemo(
    () => ({
      terminal: tabInteractionBlocked
        ? null
        : materializedWorkspacePaneRuntimeTabSessionId(model.activeTab, 'terminal'),
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
