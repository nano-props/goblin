import type { WorkspacePaneStaticTabType } from '#/shared/workspace-pane.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { SettingsPage } from '#/shared/settings-pages.ts'
import type {
  BranchWorkspacePaneRouteTarget,
  ParsedBranchWorkspacePaneRouteTarget,
  ParsedWorkspacePaneRouteTarget,
  WorkspacePaneRouteTarget,
} from '#/web/App.tsx'
import type { AppRouteNavigation } from '#/web/app-route-navigation.ts'
import type { FilesystemWorkspacePaneTabsTarget } from '#/shared/workspace-pane-tabs-target.ts'
import type { CloseWorkspaceResult, WorkspaceNavigationHistoryTraversal } from '#/web/stores/workspaces/types.ts'
import {
  restoreWorkspaceNavigationEntry,
  workspaceNavigationHistoryRestoreBlocked,
} from '#/web/workspace-navigation-history.ts'
import {
  filesystemWorkspacePaneTargetLeaseIsCurrent,
  gitBranchPaneTargetLeaseOwnerIsCurrent,
  workspaceRootPaneTargetLease,
  type FilesystemWorkspacePaneTargetLease,
  type GitBranchPaneTargetLease,
  type GitWorktreePaneTargetLease,
} from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import { openWorkspacePaneRoute } from '#/web/workspace-pane/repo-branch-workspace-pane-route.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { formatTerminalFilesystemTargetKeyForPath } from '#/shared/terminal-filesystem-target-key.ts'
import {
  beginAppNavigation,
  appNavigationIsCurrent,
  type AppNavigationExecutionOptions,
  type AppNavigationGeneration,
} from '#/web/app-navigation-lifecycle.ts'

export interface AppNavigationOptions<
  Route extends ParsedWorkspacePaneRouteTarget = ParsedWorkspacePaneRouteTarget,
> extends AppNavigationExecutionOptions {
  routePrecondition?: { kind: 'exact-route'; route: Route } | { kind: 'current-workspace-target' }
}

export type BranchAppNavigationOptions = AppNavigationOptions<ParsedBranchWorkspacePaneRouteTarget>

export type WorkspaceRootPanePresentation =
  { kind: 'static'; tab: WorkspacePaneStaticTabType } | { kind: 'terminal'; terminalSessionId: string }

export type FilesystemWorkspacePaneCommitTarget = FilesystemWorkspacePaneTargetLease

export interface WorkspacePaneRouteCommitActions {
  commitWorkspacePaneRoute: (
    workspaceId: WorkspaceId,
    branch: string,
    route: BranchWorkspacePaneRouteTarget,
    options?: BranchAppNavigationOptions,
  ) => Promise<boolean>
}

export interface FilesystemWorkspacePaneRouteCommitActions extends WorkspacePaneRouteCommitActions {
  commitFilesystemWorkspacePaneRoute: (
    target: FilesystemWorkspacePaneCommitTarget,
    route: WorkspacePaneRouteTarget,
    options?: AppNavigationOptions,
  ) => Promise<boolean>
}

export interface AppNavigationActions extends FilesystemWorkspacePaneRouteCommitActions {
  activateWorkspace: (workspaceId: WorkspaceId, options?: { navigationGeneration?: AppNavigationGeneration }) => void
  closeWorkspace: (workspaceId: WorkspaceId) => Promise<CloseWorkspaceResult>
  cycleWorkspace: (direction: 1 | -1) => void
  selectRepoBranch: (target: GitBranchPaneTargetLease, options?: { replace?: boolean }) => boolean
  selectRepoWorktree: (target: GitWorktreePaneTargetLease, options?: { replace?: boolean }) => boolean
  showWorkspaceRootPaneTab: (
    workspaceId: WorkspaceId,
    presentation: WorkspaceRootPanePresentation,
    options?: AppNavigationOptions,
  ) => boolean
  commitWorkspaceRootTerminalSession: (
    workspaceId: WorkspaceId,
    workspaceRuntimeId: string,
    terminalSessionId: string,
    options?: AppNavigationOptions,
  ) => Promise<boolean>
  currentWorkspacePaneRoute: (workspaceId: WorkspaceId, branch: string) => WorkspacePaneRouteTarget | undefined
  goBack: (workspaceId: WorkspaceId) => void
  goForward: (workspaceId: WorkspaceId) => void
  openSettings: (page: SettingsPage) => void
  openCreateWorktree: () => void
}

interface CreateAppNavigationActionsOptions {
  currentWorkspaceId: WorkspaceId | null
  workspaceOrder: WorkspaceId[]
  closeWorkspace: (workspaceId: WorkspaceId) => Promise<CloseWorkspaceResult>
  peekWorkspaceNavigation: (
    workspaceId: WorkspaceId,
    direction: 'back' | 'forward',
  ) => WorkspaceNavigationHistoryTraversal | null
  commitWorkspaceNavigation: (traversal: WorkspaceNavigationHistoryTraversal) => boolean
  routeNavigation: AppRouteNavigation
}

export function createAppNavigationActions({
  currentWorkspaceId,
  workspaceOrder,
  closeWorkspace,
  peekWorkspaceNavigation,
  commitWorkspaceNavigation,
  routeNavigation,
}: CreateAppNavigationActionsOptions): AppNavigationActions {
  const traverseWorkspaceNavigation = (workspaceId: WorkspaceId, direction: 'back' | 'forward') => {
    if (workspaceNavigationHistoryRestoreBlocked(workspaceId, direction)) return
    const canonicalWorkspaceId = workspacesStore.getState().workspaces[workspaceId]?.id
    if (!canonicalWorkspaceId) return
    const traversal = peekWorkspaceNavigation(canonicalWorkspaceId, direction)
    if (!traversal) return
    restoreWorkspaceNavigationEntry(traversal.target, routeNavigation, {
      onCommit() {
        if (!commitWorkspaceNavigation(traversal)) {
          throw new Error('workspace navigation history changed before its route committed')
        }
      },
    })
  }

  return {
    currentWorkspacePaneRoute(workspaceId, branchName) {
      return routeNavigation.currentWorkspacePaneRoute(workspaceId, branchName)
    },
    activateWorkspace(workspaceId, options) {
      const navigationGeneration = options?.navigationGeneration ?? beginAppNavigation()
      restoreWorkspacePresentationOrOpenDashboard(workspaceId, routeNavigation, navigationGeneration, {
        onBlocked: 'stay',
      })
    },
    async closeWorkspace(workspaceId) {
      const nextWorkspaceId =
        workspaceId === currentWorkspaceId ? nextWorkspaceIdAfterClose(workspaceOrder, workspaceId) : null
      const navigationGeneration = workspaceId === currentWorkspaceId ? beginAppNavigation() : null
      const result = await closeWorkspace(workspaceId)
      if (!result.ok || workspaceId !== currentWorkspaceId) return result
      if (nextWorkspaceId)
        restoreWorkspacePresentationOrOpenDashboard(nextWorkspaceId, routeNavigation, navigationGeneration!, {
          onBlocked: 'dashboard',
        })
      else routeNavigation.openHome({ navigationGeneration: navigationGeneration! })
      return result
    },
    cycleWorkspace(direction) {
      const workspaceId = nextNavigationWorkspaceId(workspaceOrder, currentWorkspaceId, direction)
      if (workspaceId) {
        const navigationGeneration = beginAppNavigation()
        restoreWorkspacePresentationOrOpenDashboard(workspaceId, routeNavigation, navigationGeneration, {
          onBlocked: 'stay',
        })
      }
    },
    selectRepoBranch(target, options) {
      if (!gitBranchPaneTargetLeaseOwnerIsCurrent(target)) return false
      return openWorkspacePaneRoute(
        routeNavigation,
        target.routeTarget.workspaceId,
        target.routeTarget.branchName,
        options,
      )
    },
    selectRepoWorktree(target, options) {
      if (!filesystemWorkspacePaneTargetLeaseIsCurrent(target)) return false
      const navigationGeneration = beginAppNavigation()
      return routeNavigation.openRepoWorktree(target.routeTarget.workspaceId, target.routeTarget.worktreePath, {
        ...options,
        navigationGeneration,
      })
    },
    showWorkspaceRootPaneTab(workspaceId, presentation, options) {
      const generation = options?.navigationGeneration ?? beginAppNavigation()
      const navigationOptions = workspaceRootPanePresentationOptions(workspaceId, presentation, options, generation)
      return presentation.kind === 'terminal'
        ? routeNavigation.openWorkspaceRootTerminal(workspaceId, presentation.terminalSessionId, navigationOptions)
        : routeNavigation.openWorkspaceRootTab(workspaceId, presentation.tab, navigationOptions)
    },
    commitFilesystemWorkspacePaneRoute(target, route, options) {
      return commitFilesystemWorkspacePaneRoute(routeNavigation, target, route, options)
    },
    commitWorkspaceRootTerminalSession(workspaceId, workspaceRuntimeId, terminalSessionId, options) {
      return commitFilesystemWorkspacePaneRoute(
        routeNavigation,
        workspaceRootPaneTargetLease(workspaceId, workspaceRuntimeId),
        { kind: 'terminal', terminalSessionId },
        options,
      )
    },
    commitWorkspacePaneRoute(workspaceId, branch, route, options) {
      return commitWorkspacePaneRoute(routeNavigation, workspaceId, branch, route, options)
    },
    goBack(workspaceId) {
      traverseWorkspaceNavigation(workspaceId, 'back')
    },
    goForward(workspaceId) {
      traverseWorkspaceNavigation(workspaceId, 'forward')
    },
    openSettings(page) {
      const navigationGeneration = beginAppNavigation()
      routeNavigation.openSettings(page, { navigationGeneration })
    },
    openCreateWorktree() {
      if (!currentWorkspaceId) return
      const navigationGeneration = beginAppNavigation()
      routeNavigation.openRepoNewWorktree(currentWorkspaceId, { navigationGeneration })
    },
  }
}

function workspaceRootPanePresentationOptions(
  workspaceId: WorkspaceId,
  presentation: WorkspaceRootPanePresentation,
  options: AppNavigationOptions | undefined,
  navigationGeneration: AppNavigationGeneration,
): AppNavigationOptions {
  return {
    ...options,
    navigationGeneration,
    onCommit: () => {
      if (!commitFilesystemWorkspacePanePresentation({ kind: 'workspace-root', workspaceId }, presentation)) {
        options?.onAbandon?.()
        return
      }
      options?.onCommit?.()
    },
  }
}

function commitFilesystemWorkspacePanePresentation(
  target: FilesystemWorkspacePaneTabsTarget,
  presentation: WorkspaceRootPanePresentation,
): boolean {
  const state = workspacesStore.getState()
  const workspaceId = target.workspaceId
  if (!state.workspaces[workspaceId]) return false
  if (presentation.kind === 'terminal') {
    state.setSelectedTerminal(
      formatTerminalFilesystemTargetKeyForPath(
        workspaceId,
        target.kind === 'workspace-root' ? workspaceId : target.worktreePath,
      ),
      presentation.terminalSessionId,
    )
  }
  state.setWorkspacePaneTabForTarget(target, presentation.kind === 'terminal' ? 'terminal' : presentation.tab)
  return true
}

async function commitFilesystemWorkspacePaneRoute(
  routeNavigation: AppRouteNavigation,
  target: FilesystemWorkspacePaneCommitTarget,
  route: WorkspacePaneRouteTarget,
  options?: AppNavigationOptions,
): Promise<boolean> {
  if (!filesystemWorkspacePaneCommitTargetIsCurrent(target)) {
    options?.onAbandon?.()
    return false
  }
  const generation = options?.navigationGeneration ?? beginAppNavigation()
  if (!appNavigationIsCurrent(generation)) {
    options?.onAbandon?.()
    return false
  }
  let effectsSettled = false
  try {
    const committed = await routeNavigation.commitFilesystemWorkspacePaneRoute(target.routeTarget, route, {
      replace: options?.replace,
      navigationGeneration: generation,
      routePrecondition: options?.routePrecondition,
    })
    const presentationCommitted =
      committed &&
      appNavigationIsCurrent(generation) &&
      filesystemWorkspacePaneCommitTargetIsCurrent(target) &&
      (route === null
        ? commitFilesystemWorkspacePaneEmptyPresentation(target.routeTarget)
        : commitFilesystemWorkspacePanePresentation(target.routeTarget, route))
    if (!presentationCommitted) {
      effectsSettled = true
      options?.onAbandon?.()
      return false
    }
    effectsSettled = true
    options?.onCommit?.()
    return true
  } catch (error) {
    if (!effectsSettled) {
      effectsSettled = true
      options?.onAbandon?.()
    }
    throw error
  }
}

function filesystemWorkspacePaneCommitTargetIsCurrent(target: FilesystemWorkspacePaneCommitTarget): boolean {
  return filesystemWorkspacePaneTargetLeaseIsCurrent(target)
}

function commitFilesystemWorkspacePaneEmptyPresentation(target: FilesystemWorkspacePaneTabsTarget): boolean {
  const state = workspacesStore.getState()
  if (!state.workspaces[target.workspaceId]) return false
  state.setWorkspacePaneTabForTarget(target, null)
  return true
}

async function commitWorkspacePaneRoute(
  routeNavigation: AppRouteNavigation,
  workspaceId: WorkspaceId,
  branchName: string,
  route: BranchWorkspacePaneRouteTarget,
  options?: BranchAppNavigationOptions,
): Promise<boolean> {
  const generation = options?.navigationGeneration ?? beginAppNavigation()
  if (!appNavigationIsCurrent(generation)) {
    options?.onAbandon?.()
    return false
  }
  const routeOptions = {
    replace: options?.replace,
    navigationGeneration: generation,
    onCommit: options?.onCommit,
    onAbandon: options?.onAbandon,
    routePrecondition: options?.routePrecondition,
  }
  return await routeNavigation.commitWorkspacePaneRoute(workspaceId, branchName, route, routeOptions)
}

function restoreWorkspacePresentationOrOpenDashboard(
  workspaceId: WorkspaceId,
  routeNavigation: AppRouteNavigation,
  navigationGeneration: AppNavigationGeneration,
  options: { onBlocked: 'stay' | 'dashboard' },
): void {
  const state = workspacesStore.getState()
  const workspace = state.workspaces[workspaceId]
  const entry = state.navigationHistoryByWorkspace[workspaceId]?.current ?? null
  // Creating a worktree is a transient workflow, not a resumable workspace presentation.
  // A non-Git workspace may resume only capability-invariant presentations;
  // stale Git-scoped history must not prevent picker activation.
  const entryCanResume =
    entry &&
    entry.route.kind !== 'newWorktree' &&
    (workspace?.capability.kind === 'git' || entry.route.kind === 'workspace-root' || entry.route.kind === 'dashboard')
  if (entryCanResume) {
    const result = restoreWorkspaceNavigationEntry(entry, routeNavigation, { navigationGeneration })
    if (result.kind === 'accepted' || (result.kind === 'blocked' && options.onBlocked === 'stay')) return
  }
  routeNavigation.openWorkspaceDashboard(workspaceId, { navigationGeneration })
}

function nextWorkspaceIdAfterClose(workspaceOrder: WorkspaceId[], closingWorkspaceId: WorkspaceId): WorkspaceId | null {
  const currentIndex = workspaceOrder.findIndex((workspaceId) => workspaceId === closingWorkspaceId)
  if (currentIndex === -1) return workspaceOrder[0] ?? null
  return workspaceOrder[currentIndex + 1] ?? workspaceOrder[currentIndex - 1] ?? null
}

function nextNavigationWorkspaceId(
  workspaceOrder: WorkspaceId[],
  currentWorkspaceId: WorkspaceId | null,
  direction: 1 | -1,
): WorkspaceId | null {
  if (workspaceOrder.length === 0) return null
  if (!currentWorkspaceId) return workspaceOrder[0] ?? null
  const currentIndex = workspaceOrder.findIndex((workspaceId) => workspaceId === currentWorkspaceId)
  if (currentIndex === -1) return workspaceOrder[0] ?? null
  return workspaceOrder[(currentIndex + direction + workspaceOrder.length) % workspaceOrder.length] ?? null
}
