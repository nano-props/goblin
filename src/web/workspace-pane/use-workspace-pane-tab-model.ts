import { computed, toValue } from 'vue'
import type { ComputedRef, MaybeRefOrGetter } from 'vue'
import type { CurrentGitWorkspacePanePresentation } from '#/web/components/repo-workspace/model.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { ParsedWorkspacePaneRoute } from '#/web/app/navigation/route-model.ts'
import {
  createWorkspacePaneTabModel,
  workspacePaneTabModelBlocksTabInteraction,
  materializedWorkspacePaneRuntimeTabSessionId,
  type WorkspacePaneTabEntriesProjectionPhase,
  type WorkspacePaneTabModel,
  type WorkspacePaneTabModelInput,
} from '#/web/workspace-pane/workspace-pane-tab-model.ts'
import { preferredWorkspacePaneTabForTarget } from '#/web/stores/workspaces/workspace-pane-preferences.ts'
import type { WorkspacePanePreferenceState } from '#/web/stores/workspaces/workspace-pane-preferences.ts'
import {
  useWorkspacePaneTabsQuery,
  projectWorkspacePaneTabsForTarget,
} from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { useWorkspacePaneRuntimeTabTargetProjection } from '#/web/workspace-pane/use-workspace-pane-runtime-tab-target-projection.ts'
import { useSyncWorkspacePaneRuntimeTabProviderSelection } from '#/web/workspace-pane/workspace-pane-runtime-tab-providers.ts'
import type { WorkspacePaneTabType } from '#/shared/workspace-pane.ts'
import type { WorkspaceRepoWorktreeSnapshot } from '#/shared/git-types.ts'
import { workspaceRootFilesystemExecutionTarget } from '#/shared/workspace-runtime.ts'
import {
  workspacePaneLocationForBranch,
  workspacePaneLocationExecutionTarget,
  workspacePaneLocationForWorktree,
  workspacePaneLocationForRoot,
} from '#/web/workspace-pane/workspace-pane-location.ts'

export interface WorkspacePaneModelWorkspace {
  id: WorkspaceId
  workspaceRuntimeId: string
  ui: WorkspacePanePreferenceState
}

export type WorkspacePaneRuntimeContext = Pick<WorkspacePaneModelWorkspace, 'workspaceRuntimeId' | 'ui'>

export function useGitWorkspacePaneTabModel(
  gitWorkspace: MaybeRefOrGetter<WorkspacePaneModelWorkspace>,
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
  gitWorkspace: MaybeRefOrGetter<WorkspacePaneModelWorkspace>,
  detail: MaybeRefOrGetter<CurrentGitWorkspacePanePresentation>,
  workspacePaneRoute: MaybeRefOrGetter<ParsedWorkspacePaneRoute | null | undefined>,
): ComputedRef<WorkspacePaneTabModelInput> {
  const workspace = computed(() => toValue(gitWorkspace))
  const branchName = computed(() => toValue(detail).branch?.name ?? null)
  const worktree = computed(() => toValue(detail).worktree ?? null)
  const runtimeProjection = useWorkspacePaneRuntimeTabTargetProjection({
    workspaceId: () => workspace.value.id,
    workspaceRuntimeId: () => workspace.value.workspaceRuntimeId,
    filesystemTarget: () =>
      branchName.value
        ? (() => {
            const context = workspacePaneLocationForBranch(
              workspace.value.id,
              workspace.value.workspaceRuntimeId,
              branchName.value,
              worktree.value,
            )
            return context.kind === 'branch' ? null : workspacePaneLocationExecutionTarget(context)
          })()
        : null,
  })
  const workspacePaneTabsQuery = useWorkspacePaneTabsQuery(
    () => workspace.value.id,
    () => workspace.value.workspaceRuntimeId,
  )

  return computed(() => {
    const currentWorkspace = workspace.value
    const currentBranchName = branchName.value
    const currentWorktree = worktree.value
    const route = toValue(workspacePaneRoute)
    const location = currentBranchName
      ? workspacePaneLocationForBranch(
          currentWorkspace.id,
          currentWorkspace.workspaceRuntimeId,
          currentBranchName,
          currentWorktree,
        )
      : null
    const routedWorktree = location?.kind === 'source-worktree' || location?.kind === 'linked-worktree'
    const tabEntriesProjectionPhase = workspacePaneTabsProjectionPhase(workspacePaneTabsQuery.status.value)
    const tabEntries = projectWorkspacePaneTabsForTarget(
      workspacePaneTabsQuery.data.value,
      tabEntriesProjectionPhase,
      location?.paneTarget ?? {
        kind: 'inactive',
        workspaceId: currentWorkspace.id,
        branchName: null,
        worktreePath: null,
      },
    ).tabs
    const preferredTab =
      route?.kind === 'static'
        ? route.tab
        : route?.kind === 'terminal'
          ? 'terminal'
          : route?.kind === 'invalid-static' || (route === null && !routedWorktree)
            ? null
            : (preferredWorkspacePaneTabForTarget(currentWorkspace.ui, location?.paneTarget) ??
              tabEntries[0]?.type ??
              null)
    return {
      workspaceId: currentWorkspace.id,
      workspaceRuntimeId: currentWorkspace.workspaceRuntimeId,
      location,
      preferredTab,
      allowPreferredTabFallback: route === undefined || (route === null && routedWorktree),
      tabEntries,
      tabEntriesProjectionPhase,
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
    const location = workspacePaneLocationForRoot(current.id, current.workspaceRuntimeId)
    const target = location.paneTarget
    const tabEntriesProjectionPhase = workspacePaneTabsProjectionPhase(tabsQuery.status.value)
    const tabEntries = projectWorkspacePaneTabsForTarget(tabsQuery.data.value, tabEntriesProjectionPhase, target).tabs
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
      location,
      preferredTab,
      allowPreferredTabFallback: route === null,
      tabEntries,
      tabEntriesProjectionPhase,
      runtimeTabViews: runtimeProjection.value.runtimeTabViews,
      runtimeTabStateByType: runtimeProjection.value.runtimeTabStateByType,
      requestedSessionIdByRuntimeType: requestedSessionId ? { terminal: requestedSessionId } : undefined,
    })
  })
}

export function useGitWorktreeWorkspacePaneTabModel(
  workspaceId: MaybeRefOrGetter<WorkspaceId>,
  workspaceRuntime: MaybeRefOrGetter<WorkspacePaneRuntimeContext>,
  worktree: MaybeRefOrGetter<WorkspaceRepoWorktreeSnapshot>,
  workspacePaneRoute: MaybeRefOrGetter<ParsedWorkspacePaneRoute | null>,
): ComputedRef<WorkspacePaneTabModel> {
  const currentWorkspaceId = computed(() => toValue(workspaceId))
  const currentWorkspaceRuntime = computed(() => toValue(workspaceRuntime))
  const currentWorktree = computed(() => toValue(worktree))
  const currentLocation = computed(() =>
    workspacePaneLocationForWorktree(
      currentWorkspaceId.value,
      currentWorkspaceRuntime.value.workspaceRuntimeId,
      currentWorktree.value,
    ),
  )
  const runtimeProjection = useWorkspacePaneRuntimeTabTargetProjection({
    workspaceId: () => currentWorkspaceId.value,
    workspaceRuntimeId: () => currentWorkspaceRuntime.value.workspaceRuntimeId,
    filesystemTarget: () => workspacePaneLocationExecutionTarget(currentLocation.value),
  })
  const tabsQuery = useWorkspacePaneTabsQuery(
    () => currentWorkspaceId.value,
    () => currentWorkspaceRuntime.value.workspaceRuntimeId,
  )
  return computed(() => {
    const currentRuntime = currentWorkspaceRuntime.value
    const current = currentLocation.value.paneTarget
    const route = toValue(workspacePaneRoute)
    const tabEntriesProjectionPhase = workspacePaneTabsProjectionPhase(tabsQuery.status.value)
    const tabEntries = projectWorkspacePaneTabsForTarget(tabsQuery.data.value, tabEntriesProjectionPhase, current).tabs
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
      location: currentLocation.value,
      preferredTab,
      allowPreferredTabFallback: route === null,
      tabEntries,
      tabEntriesProjectionPhase,
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
