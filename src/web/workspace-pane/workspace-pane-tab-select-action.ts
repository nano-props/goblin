import type { RepoBranchWorkspacePaneRoute } from '#/web/App.tsx'
import type { PrimaryWindowNavigationActions } from '#/web/primary-window-navigation.tsx'
import { adjacentRepoWorkspaceTab, isRepoWorkspaceRuntimeTab } from '#/web/workspace-pane/repo-workspace-tab-model.ts'
import {
  selectWorkspacePaneControllerTab,
  showWorkspacePaneControllerRoute,
} from '#/web/workspace-pane/workspace-pane-tab-controller.ts'
import {
  dispatchWorkspacePaneRuntimeTabPrimaryAction,
  type WorkspacePaneRuntimeTabActionContext,
} from '#/web/workspace-pane/workspace-pane-runtime-tab-actions.ts'
import {
  workspacePaneTabTargetBlocksInteraction,
  workspacePaneTabTargetForBranch,
} from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import { runWorkspacePaneTabCoordinatorTask } from '#/web/workspace-pane/workspace-pane-tab-coordinator.ts'

export interface SelectWorkspacePaneTabByIndexActionOptions {
  repoId: string | null
  branchName: string | null
  workspacePaneRoute: RepoBranchWorkspacePaneRoute | null | undefined
  tabIndex: number
  navigation: PrimaryWindowNavigationActions
}

export interface MoveWorkspacePaneTabActionOptions {
  repoId: string | null
  branchName: string | null
  workspacePaneRoute: RepoBranchWorkspacePaneRoute | null | undefined
  direction: 1 | -1
  navigation: PrimaryWindowNavigationActions
}

export interface SelectWorkspacePaneTabByIdentityActionOptions {
  repoId: string | null
  branchName: string | null
  workspacePaneRoute: RepoBranchWorkspacePaneRoute | null | undefined
  identity: string
  navigation: PrimaryWindowNavigationActions
  runtimeActionContext?: WorkspacePaneRuntimeTabActionContext
  reselect?: boolean
}

export interface ShowWorkspacePaneTerminalRouteActionOptions {
  repoId: string | null
  branchName: string | null
  terminalSessionId: string
  navigation: PrimaryWindowNavigationActions
}

export async function dispatchSelectWorkspacePaneTabByIndexAction(
  options: SelectWorkspacePaneTabByIndexActionOptions,
): Promise<boolean> {
  if (!options.repoId || !options.branchName || options.tabIndex < 1) return false
  return await runWorkspacePaneTabCoordinatorTask(
    { repoId: options.repoId, branchName: options.branchName },
    () => selectWorkspacePaneTabByIndexAction(options),
  )
}

function selectWorkspacePaneTabByIndexAction({
  repoId,
  branchName,
  workspacePaneRoute,
  tabIndex,
  navigation,
}: SelectWorkspacePaneTabByIndexActionOptions): boolean {
  if (!repoId || !branchName || tabIndex < 1) return false
  const target = workspacePaneTabTargetForBranch(repoId, branchName, { workspacePaneRoute })
  const tab = target?.tabs[tabIndex - 1]
  if (!target || !tab) return false
  if (workspacePaneTabTargetBlocksInteraction(target)) return false
  if (tab.kind === 'pending') return false
  return selectWorkspacePaneControllerTab(target, tab, navigation)
}

export async function dispatchSelectWorkspacePaneTabByIdentityAction(
  options: SelectWorkspacePaneTabByIdentityActionOptions,
): Promise<boolean> {
  if (!options.repoId || !options.branchName) return false
  return await runWorkspacePaneTabCoordinatorTask(
    { repoId: options.repoId, branchName: options.branchName },
    () => selectWorkspacePaneTabByIdentityAction(options),
  )
}

function selectWorkspacePaneTabByIdentityAction({
  repoId,
  branchName,
  workspacePaneRoute,
  identity,
  navigation,
  runtimeActionContext,
  reselect,
}: SelectWorkspacePaneTabByIdentityActionOptions): boolean {
  if (!repoId || !branchName) return false
  const target = workspacePaneTabTargetForBranch(repoId, branchName, { workspacePaneRoute })
  const tab = target?.tabs.find((candidate) => candidate.identity === identity) ?? null
  if (!target || !tab) return false
  if (workspacePaneTabTargetBlocksInteraction(target)) return false
  if (tab.kind === 'pending') return false
  if (runtimeActionContext && isRepoWorkspaceRuntimeTab(tab)) {
    return dispatchWorkspacePaneRuntimeTabPrimaryAction(tab.view, runtimeActionContext, { reselect })
  }
  return selectWorkspacePaneControllerTab(target, tab, navigation)
}

export async function dispatchShowWorkspacePaneTerminalRouteAction(
  options: ShowWorkspacePaneTerminalRouteActionOptions,
): Promise<boolean> {
  if (!options.repoId || !options.branchName) return false
  return await runWorkspacePaneTabCoordinatorTask(
    { repoId: options.repoId, branchName: options.branchName },
    () =>
      showWorkspacePaneControllerRoute(
        options.repoId!,
        options.branchName!,
        { kind: 'terminal', terminalSessionId: options.terminalSessionId },
        options.navigation,
      ),
  )
}

export async function dispatchMoveWorkspacePaneTabAction(options: MoveWorkspacePaneTabActionOptions): Promise<boolean> {
  if (!options.repoId || !options.branchName) return false
  return await runWorkspacePaneTabCoordinatorTask(
    { repoId: options.repoId, branchName: options.branchName },
    () => moveWorkspacePaneTabAction(options),
  )
}

function moveWorkspacePaneTabAction({
  repoId,
  branchName,
  workspacePaneRoute,
  direction,
  navigation,
}: MoveWorkspacePaneTabActionOptions): boolean {
  if (!repoId || !branchName) return false
  const target = workspacePaneTabTargetForBranch(repoId, branchName, { workspacePaneRoute })
  const tab = target ? adjacentRepoWorkspaceTab(target.tabs, target.activeTab?.identity, direction) : null
  if (!target || !tab) return false
  if (workspacePaneTabTargetBlocksInteraction(target)) return false
  return selectWorkspacePaneControllerTab(target, tab, navigation)
}
