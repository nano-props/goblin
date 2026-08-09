import { computed, toValue } from 'vue'
import type { ComputedRef, MaybeRefOrGetter } from 'vue'
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
  gitWorkspace: MaybeRefOrGetter<Pick<GitWorkspacePaneProjection, 'id' | 'workspaceRuntimeId' | 'ui'>>,
  detail: MaybeRefOrGetter<CurrentGitWorkspacePanePresentation>,
  workspacePaneRoute: MaybeRefOrGetter<ParsedWorkspacePaneRoute | null | undefined>,
): ComputedRef<WorkspacePaneTabModel> {
  const input = useGitWorkspacePaneTabModelInput(gitWorkspace, detail, workspacePaneRoute)
  return computed(() => createWorkspacePaneTabModel(input.value))
}

/**
 * Reads Git workspace and runtime-tab state and packages the pure tab-model input.
 * No writes happen here; this is the data boundary into the workspace pane tab
 * projection.
 */
export function useGitWorkspacePaneTabModelInput(
  gitWorkspace: MaybeRefOrGetter<Pick<GitWorkspacePaneProjection, 'id' | 'workspaceRuntimeId' | 'ui'>>,
  detail: MaybeRefOrGetter<CurrentGitWorkspacePanePresentation>,
  workspacePaneRoute: MaybeRefOrGetter<ParsedWorkspacePaneRoute | null | undefined>,
): ComputedRef<WorkspacePaneTabModelInput> {
  const workspace = computed(() => toValue(gitWorkspace))
  const branchName = computed(() => toValue(detail).branch?.name ?? null)
  const worktreePath = computed(() => toValue(detail).branch?.worktree?.path ?? null)
  const runtimeProjection = useWorkspacePaneRuntimeTabTargetProjection({
    workspaceId: () => workspace.value.id,
    workspaceRuntimeId: () => workspace.value.workspaceRuntimeId,
    filesystemTarget: () =>
      worktreePath.value
        ? gitWorktreeFilesystemExecutionTarget(
            workspace.value.id,
            workspace.value.workspaceRuntimeId,
            worktreePath.value,
          )
        : null,
  })
  const workspacePaneTabsQuery = useWorkspacePaneTabsQuery(
    () => workspace.value.id,
    () => workspace.value.workspaceRuntimeId,
  )

  return computed(() => {
    const currentWorkspace = workspace.value
    const currentBranchName = branchName.value
    const currentWorktreePath = worktreePath.value
    const route = toValue(workspacePaneRoute)
    const target = currentBranchName
      ? requiredGitWorkspacePaneTabsTarget(currentWorkspace.id, currentBranchName, currentWorktreePath)
      : null
    const tabEntries = workspacePaneTabsForTargetFromQueryData(
      workspacePaneTabsQuery.data.value ?? { revision: 0, entries: [] },
      target ?? {
        kind: 'inactive',
        workspaceId: currentWorkspace.id,
        branchName: null,
        worktreePath: null,
      },
    )
    const preferredTab =
      route?.kind === 'static'
        ? route.tab
        : route?.kind === 'terminal'
          ? 'terminal'
          : route?.kind === 'invalid-static' || route === null
            ? null
            : (preferredWorkspacePaneTabForTarget(currentWorkspace.ui, target) ?? tabEntries[0]?.type ?? null)
    return {
      workspaceId: currentWorkspace.id,
      workspaceRuntimeId: currentWorkspace.workspaceRuntimeId,
      routeTarget: currentBranchName
        ? { kind: 'git-branch', workspaceId: currentWorkspace.id, branchName: currentBranchName }
        : { kind: 'inactive', workspaceId: currentWorkspace.id },
      paneTarget: target ?? { kind: 'inactive', workspaceId: currentWorkspace.id },
      worktreeHead:
        currentBranchName && currentWorktreePath
          ? { kind: 'branch' as const, branchName: currentBranchName }
          : undefined,
      preferredTab,
      allowPreferredTabFallback: route === undefined,
      tabEntries,
      tabEntriesProjectionPhase: workspacePaneTabsProjectionPhase(workspacePaneTabsQuery.status.value),
      runtimeTabViews: runtimeProjection.value.runtimeTabViews,
      runtimeTabStateByType: runtimeProjection.value.runtimeTabStateByType,
      requestedSessionIdByRuntimeType: route?.kind === 'terminal' ? { terminal: route.terminalSessionId } : undefined,
    }
  })
}

export function useWorkspaceRootTabModel(
  workspace: MaybeRefOrGetter<WorkspacePaneModelWorkspace>,
  workspacePaneRoute: MaybeRefOrGetter<ParsedWorkspacePaneRoute | null>,
): ComputedRef<WorkspacePaneTabModel> {
  const currentWorkspace = computed(() => toValue(workspace))
  const runtimeProjection = useWorkspacePaneRuntimeTabTargetProjection({
    workspaceId: () => currentWorkspace.value.id,
    workspaceRuntimeId: () => currentWorkspace.value.workspaceRuntimeId,
    filesystemTarget: () =>
      workspaceRootFilesystemExecutionTarget(currentWorkspace.value.id, currentWorkspace.value.workspaceRuntimeId),
  })
  const tabsQuery = useWorkspacePaneTabsQuery(
    () => currentWorkspace.value.id,
    () => currentWorkspace.value.workspaceRuntimeId,
  )
  return computed(() => {
    const current = currentWorkspace.value
    const route = toValue(workspacePaneRoute)
    const target = { kind: 'workspace-root' as const, workspaceId: current.id }
    const tabEntries = workspacePaneTabsForTargetFromQueryData(
      tabsQuery.data.value ?? { revision: 0, entries: [] },
      target,
    )
    const requestedTab = route?.kind === 'terminal' ? 'terminal' : route?.kind === 'static' ? route.tab : null
    const requestedSessionId = route?.kind === 'terminal' ? route.terminalSessionId : null
    const preferredTab = route
      ? requestedTab
      : tabEntries.length > 0
        ? (preferredWorkspacePaneTabForTarget(current.ui, target) ?? tabEntries[0]!.type)
        : null
    return createWorkspacePaneTabModel({
      workspaceId: current.id,
      workspaceRuntimeId: current.workspaceRuntimeId,
      routeTarget: target,
      paneTarget: target,
      preferredTab,
      allowPreferredTabFallback: route === null,
      tabEntries,
      tabEntriesProjectionPhase: workspacePaneTabsProjectionPhase(tabsQuery.status.value),
      runtimeTabViews: runtimeProjection.value.runtimeTabViews,
      runtimeTabStateByType: runtimeProjection.value.runtimeTabStateByType,
      requestedSessionIdByRuntimeType: requestedSessionId ? { terminal: requestedSessionId } : undefined,
    })
  })
}

export function useGitWorktreeWorkspacePaneTabModel(
  workspaceRuntime: MaybeRefOrGetter<WorkspacePaneRuntimeContext>,
  target: MaybeRefOrGetter<GitWorktreeWorkspacePaneTabsTarget>,
  worktreeHead: MaybeRefOrGetter<GitHead>,
  workspacePaneRoute: MaybeRefOrGetter<ParsedWorkspacePaneRoute | null>,
): ComputedRef<WorkspacePaneTabModel> {
  const currentWorkspaceRuntime = computed(() => toValue(workspaceRuntime))
  const currentTarget = computed(() => toValue(target))
  const runtimeProjection = useWorkspacePaneRuntimeTabTargetProjection({
    workspaceId: () => currentTarget.value.workspaceId,
    workspaceRuntimeId: () => currentWorkspaceRuntime.value.workspaceRuntimeId,
    filesystemTarget: () =>
      gitWorktreeFilesystemExecutionTarget(
        currentTarget.value.workspaceId,
        currentWorkspaceRuntime.value.workspaceRuntimeId,
        currentTarget.value.worktreePath,
      ),
  })
  const tabsQuery = useWorkspacePaneTabsQuery(
    () => currentTarget.value.workspaceId,
    () => currentWorkspaceRuntime.value.workspaceRuntimeId,
  )
  return computed(() => {
    const currentRuntime = currentWorkspaceRuntime.value
    const current = currentTarget.value
    const route = toValue(workspacePaneRoute)
    const tabEntries = workspacePaneTabsForTargetFromQueryData(
      tabsQuery.data.value ?? { revision: 0, entries: [] },
      current,
    )
    const requestedTab = route?.kind === 'terminal' ? 'terminal' : route?.kind === 'static' ? route.tab : null
    const requestedSessionId = route?.kind === 'terminal' ? route.terminalSessionId : null
    const preferredTab = route
      ? requestedTab
      : tabEntries.length > 0
        ? (preferredWorkspacePaneTabForTarget(currentRuntime.ui, current) ?? tabEntries[0]!.type)
        : null
    return createWorkspacePaneTabModel({
      workspaceId: current.workspaceId,
      workspaceRuntimeId: currentRuntime.workspaceRuntimeId,
      routeTarget: current,
      paneTarget: current,
      worktreeHead: toValue(worktreeHead),
      preferredTab,
      allowPreferredTabFallback: route === null,
      tabEntries,
      tabEntriesProjectionPhase: workspacePaneTabsProjectionPhase(tabsQuery.status.value),
      runtimeTabViews: runtimeProjection.value.runtimeTabViews,
      runtimeTabStateByType: runtimeProjection.value.runtimeTabStateByType,
      requestedSessionIdByRuntimeType: requestedSessionId ? { terminal: requestedSessionId } : undefined,
    })
  })
}

function workspacePaneTabsProjectionPhase(
  status: ReturnType<typeof useWorkspacePaneTabsQuery>['status']['value'],
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
  model: MaybeRefOrGetter<
    Pick<WorkspacePaneTabModel, 'activeTab' | 'runtimeTabTargetKeyByType' | 'runtimeTabStateByType'>
  >,
  options: { enabled: MaybeRefOrGetter<boolean> },
): void {
  const currentModel = computed(() => toValue(model))
  const activeSessionIdByRuntimeType = computed(() => {
    const current = currentModel.value
    const tabInteractionBlocked = !toValue(options.enabled) || workspacePaneTabModelBlocksTabInteraction(current)
    return {
      terminal: tabInteractionBlocked
        ? null
        : materializedWorkspacePaneRuntimeTabSessionId(current.activeTab, 'terminal'),
    }
  })
  const selectedSessionIdByRuntimeType = computed(() => ({
    terminal: currentModel.value.runtimeTabStateByType.terminal.selectedSessionId,
  }))
  const selectionInput = computed(() => ({
    activeSessionIdByRuntimeType: activeSessionIdByRuntimeType.value,
    runtimeTabTargetKeyByType: currentModel.value.runtimeTabTargetKeyByType,
  }))
  useSyncWorkspacePaneRuntimeTabProviderSelection(selectionInput, selectedSessionIdByRuntimeType)
}
