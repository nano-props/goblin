import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { SettingsPage } from '#/shared/settings-pages.ts'
import type {
  BranchWorkspacePaneRouteTarget,
  ParsedBranchWorkspacePaneRouteTarget,
  ParsedWorkspacePaneRouteTarget,
  WorkspacePaneRoute,
  WorkspacePaneRouteTarget,
} from '#/web/app/navigation/route-model.ts'
import type { AppRouteNavigation } from '#/web/app/navigation/route-navigation.ts'
import type { CloseWorkspaceResult, WorkspaceNavigationHistoryTraversal } from '#/web/stores/workspaces/types.ts'
import {
  restoreWorkspaceNavigationEntry,
  workspaceNavigationHistoryRestoreBlocked,
} from '#/web/app/navigation/workspace-history.ts'
import {
  filesystemWorkspacePaneLocationIsCurrent,
  filesystemWorkspacePaneRouteLeaseIsCurrent,
  gitBranchPaneTargetLeaseOwnerIsCurrent,
  type GitBranchPaneTargetLease,
  type GitWorktreePaneRouteLease,
} from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import { openWorkspacePaneRoute } from '#/web/workspace-pane/repo-branch-workspace-pane-route.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { formatTerminalFilesystemTargetKey } from '#/shared/terminal-filesystem-target-key.ts'
import { terminalExecutionCoordinates } from '#/shared/terminal-types.ts'
import {
  workspacePaneLocationExecutionTarget,
  type FilesystemWorkspacePaneLocation,
} from '#/web/workspace-pane/workspace-pane-location.ts'
import {
  beginAppNavigation,
  appNavigationIsCurrent,
  type AppNavigationExecutionOptions,
  type AppNavigationGeneration,
} from '#/web/app/navigation/lifecycle.ts'

export interface AppNavigationOptions<
  Route extends ParsedWorkspacePaneRouteTarget = ParsedWorkspacePaneRouteTarget,
> extends AppNavigationExecutionOptions {
  routePrecondition?: { kind: 'exact-route'; route: Route } | { kind: 'current-workspace-target' }
}

export type BranchAppNavigationOptions = AppNavigationOptions<ParsedBranchWorkspacePaneRouteTarget>

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
    location: FilesystemWorkspacePaneLocation,
    route: WorkspacePaneRouteTarget,
    options?: AppNavigationOptions,
  ) => Promise<boolean>
}

export interface AppNavigationActions extends FilesystemWorkspacePaneRouteCommitActions {
  activateWorkspace: (workspaceId: WorkspaceId, options?: { navigationGeneration?: AppNavigationGeneration }) => void
  closeWorkspace: (workspaceId: WorkspaceId) => Promise<CloseWorkspaceResult>
  cycleWorkspace: (direction: 1 | -1) => void
  selectRepoBranch: (target: GitBranchPaneTargetLease, options?: { replace?: boolean }) => boolean
  selectRepoWorktree: (target: GitWorktreePaneRouteLease, options?: { replace?: boolean }) => boolean
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
      if (!filesystemWorkspacePaneRouteLeaseIsCurrent(target)) return false
      const navigationGeneration = beginAppNavigation()
      return routeNavigation.openRepoWorktree(target.routeTarget.workspaceId, target.routeTarget.worktreePath, {
        ...options,
        navigationGeneration,
      })
    },
    commitFilesystemWorkspacePaneRoute(location, route, options) {
      return commitFilesystemWorkspacePaneRoute(routeNavigation, location, route, options)
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

function commitFilesystemWorkspacePanePresentation(
  location: FilesystemWorkspacePaneLocation,
  presentation: WorkspacePaneRoute,
): boolean {
  const state = workspacesStore.getState()
  const workspaceId = location.workspaceId
  if (!state.workspaces[workspaceId]) return false
  if (presentation.kind === 'terminal') {
    const coordinates = terminalExecutionCoordinates(workspacePaneLocationExecutionTarget(location))
    state.setSelectedTerminal(
      formatTerminalFilesystemTargetKey(workspaceId, coordinates.executionRootId),
      presentation.terminalSessionId,
    )
  }
  state.setWorkspacePaneTabForTarget(
    location.routeTarget,
    presentation.kind === 'terminal' ? 'terminal' : presentation.tab,
  )
  return true
}

async function commitFilesystemWorkspacePaneRoute(
  routeNavigation: AppRouteNavigation,
  location: FilesystemWorkspacePaneLocation,
  route: WorkspacePaneRouteTarget,
  options?: AppNavigationOptions,
): Promise<boolean> {
  if (!filesystemWorkspacePaneLocationIsCurrent(location)) {
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
    const committed = await routeNavigation.commitFilesystemWorkspacePaneRoute(location.routeTarget, route, {
      replace: options?.replace,
      navigationGeneration: generation,
      routePrecondition: options?.routePrecondition,
    })
    const presentationCommitted =
      committed &&
      appNavigationIsCurrent(generation) &&
      filesystemWorkspacePaneLocationIsCurrent(location) &&
      (route === null
        ? commitFilesystemWorkspacePaneEmptyPresentation(location)
        : commitFilesystemWorkspacePanePresentation(location, route))
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

function commitFilesystemWorkspacePaneEmptyPresentation(location: FilesystemWorkspacePaneLocation): boolean {
  const state = workspacesStore.getState()
  if (!state.workspaces[location.workspaceId]) return false
  state.setWorkspacePaneTabForTarget(location.routeTarget, null)
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
    (workspace?.capability.kind === 'git'
      ? entry.route.kind !== 'workspace-root'
      : entry.route.kind === 'workspace-root' || entry.route.kind === 'dashboard')
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
