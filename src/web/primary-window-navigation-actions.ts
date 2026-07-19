import type { WorkspacePaneStaticTabType } from '#/shared/workspace-pane.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { SettingsPage } from '#/shared/settings-pages.ts'
import type { WorkspacePaneRouteTarget } from '#/web/App.tsx'
import type { PrimaryWindowRouteNavigation } from '#/web/primary-window-route-navigation.ts'
import type { CloseWorkspaceResult, WorkspaceNavigationHistoryTraversal } from '#/web/stores/workspaces/types.ts'
import {
  restoreWorkspaceNavigationEntry,
  workspaceNavigationHistoryRestoreBlocked,
} from '#/web/workspace-navigation-history.ts'
import { workspacePaneRouteNavigationBlockedForBranch } from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import { openWorkspacePaneRoute } from '#/web/workspace-pane/repo-branch-workspace-pane-route.ts'
import { openResolvedWorkspacePaneRoute } from '#/web/workspace-pane/repo-branch-workspace-pane-route-navigation.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { readRepoBranchSnapshotQueryProjection } from '#/web/repo-branch-read-model.ts'
import { formatTerminalFilesystemTargetKeyForPath } from '#/shared/terminal-filesystem-target-key.ts'
import {
  beginPrimaryWindowPresentation,
  primaryWindowPresentationIsCurrent,
  type PrimaryWindowPresentationToken,
} from '#/web/primary-window-presentation.ts'

type MaybePromise<T> = T | Promise<T>

export interface PrimaryWindowPresentationNavigationOptions {
  replace?: boolean
  presentationToken?: PrimaryWindowPresentationToken
  onCommit?: () => void
  routePrecondition?: { kind: 'exact-route'; route: WorkspacePaneRouteTarget } | { kind: 'current-workspace-target' }
}

export type WorkspaceRootPanePresentation =
  { kind: 'static'; tab: WorkspacePaneStaticTabType } | { kind: 'terminal'; terminalSessionId: string }

export interface PrimaryWindowNavigationActions {
  activateWorkspace: (workspaceId: WorkspaceId) => void
  closeWorkspace: (workspaceId: WorkspaceId) => Promise<CloseWorkspaceResult>
  cycleWorkspace: (direction: 1 | -1) => void
  selectRepoBranch: (workspaceId: WorkspaceId, branch: string, options?: { replace?: boolean }) => boolean
  showRepoBranchEmptyWorkspacePane: (
    workspaceId: WorkspaceId,
    branch: string,
    options?: { replace?: boolean },
  ) => boolean
  showRepoBranchWorkspacePaneTab: (
    workspaceId: WorkspaceId,
    branch: string,
    tab: WorkspacePaneStaticTabType,
    options?: { replace?: boolean },
  ) => boolean
  showRepoBranchTerminalSession: (
    workspaceId: WorkspaceId,
    branch: string,
    terminalSessionId: string,
    options?: { replace?: boolean },
  ) => boolean
  showRepoWorktreeTerminalSession?: (
    workspaceId: WorkspaceId,
    worktreePath: string,
    terminalSessionId: string,
    options?: PrimaryWindowPresentationNavigationOptions,
  ) => boolean
  showRepoWorktreeWorkspacePaneTab?: (
    workspaceId: WorkspaceId,
    worktreePath: string,
    tab: WorkspacePaneStaticTabType,
    options?: PrimaryWindowPresentationNavigationOptions,
  ) => boolean
  showWorkspaceRootPaneTab?: (
    workspaceId: WorkspaceId,
    presentation: WorkspaceRootPanePresentation,
    options?: PrimaryWindowPresentationNavigationOptions,
  ) => boolean
  commitWorkspacePaneRoute: (
    workspaceId: WorkspaceId,
    branch: string,
    route: WorkspacePaneRouteTarget,
    options?: PrimaryWindowPresentationNavigationOptions,
  ) => MaybePromise<boolean>
  currentWorkspacePaneRoute: (workspaceId: WorkspaceId, branch: string) => WorkspacePaneRouteTarget | undefined
  goBack: (workspaceId: WorkspaceId) => void
  goForward: (workspaceId: WorkspaceId) => void
  openSettings: (page: SettingsPage) => void
  openCreateWorktree: () => void
}

interface CreatePrimaryWindowNavigationActionsOptions {
  currentWorkspaceId: WorkspaceId | null
  workspaceOrder: WorkspaceId[]
  closeWorkspace: (workspaceId: WorkspaceId) => Promise<CloseWorkspaceResult>
  peekWorkspaceNavigation: (
    workspaceId: WorkspaceId,
    direction: 'back' | 'forward',
  ) => WorkspaceNavigationHistoryTraversal | null
  commitWorkspaceNavigation: (traversal: WorkspaceNavigationHistoryTraversal) => boolean
  routeNavigation: PrimaryWindowRouteNavigation
}

export function createPrimaryWindowNavigationActions({
  currentWorkspaceId,
  workspaceOrder,
  closeWorkspace,
  peekWorkspaceNavigation,
  commitWorkspaceNavigation,
  routeNavigation,
}: CreatePrimaryWindowNavigationActionsOptions): PrimaryWindowNavigationActions {
  return {
    currentWorkspacePaneRoute(workspaceId, branchName) {
      return routeNavigation.currentWorkspacePaneRoute(workspaceId, branchName)
    },
    activateWorkspace(workspaceId) {
      const presentationToken = beginPrimaryWindowPresentation()
      restoreWorkspacePresentationOrOpenDashboard(workspaceId, routeNavigation, presentationToken, {
        onBlocked: 'stay',
      })
    },
    async closeWorkspace(workspaceId) {
      const nextWorkspaceId =
        workspaceId === currentWorkspaceId ? nextWorkspaceIdAfterClose(workspaceOrder, workspaceId) : null
      const presentationToken = workspaceId === currentWorkspaceId ? beginPrimaryWindowPresentation() : null
      const result = await closeWorkspace(workspaceId)
      if (!result.ok || workspaceId !== currentWorkspaceId) return result
      if (nextWorkspaceId)
        restoreWorkspacePresentationOrOpenDashboard(nextWorkspaceId, routeNavigation, presentationToken!, {
          onBlocked: 'dashboard',
        })
      else routeNavigation.openHome({ presentationToken: presentationToken! })
      return result
    },
    cycleWorkspace(direction) {
      const workspaceId = nextNavigationWorkspaceId(workspaceOrder, currentWorkspaceId, direction)
      if (workspaceId) {
        const presentationToken = beginPrimaryWindowPresentation()
        restoreWorkspacePresentationOrOpenDashboard(workspaceId, routeNavigation, presentationToken, {
          onBlocked: 'stay',
        })
      }
    },
    selectRepoBranch(workspaceId, branch, options) {
      const presentationToken = beginPrimaryWindowPresentation()
      return openWorkspacePaneRoute(routeNavigation, workspaceId, branch, { ...options, presentationToken })
    },
    showRepoBranchEmptyWorkspacePane(workspaceId, branch, options) {
      const token = beginPrimaryWindowPresentation()
      return routeNavigation.openRepoBranch(workspaceId, branch, {
        ...options,
        presentationToken: token,
        onCommit: () => rememberWorkspacePaneRouteSelection(workspaceId, branch, { kind: 'empty' }),
      })
    },
    showRepoBranchWorkspacePaneTab(workspaceId, branch, tab, options) {
      if (workspacePaneRouteNavigationBlockedForBranch(workspaceId, branch)) return false
      const token = beginPrimaryWindowPresentation()
      const onCommit = () => rememberWorkspacePaneRouteSelection(workspaceId, branch, { kind: 'static' as const, tab })
      const accepted = options
        ? routeNavigation.openRepoBranchTab(workspaceId, branch, tab, {
            ...options,
            presentationToken: token,
            onCommit,
          })
        : routeNavigation.openRepoBranchTab(workspaceId, branch, tab, {
            presentationToken: token,
            onCommit,
          })
      if (!accepted) return false
      return true
    },
    showRepoBranchTerminalSession(workspaceId, branch, terminalSessionId, options) {
      if (workspacePaneRouteNavigationBlockedForBranch(workspaceId, branch)) return false
      const token = beginPrimaryWindowPresentation()
      const accepted = options
        ? routeNavigation.openRepoBranchTerminal(workspaceId, branch, terminalSessionId, {
            ...options,
            presentationToken: token,
            onCommit: () =>
              rememberWorkspacePaneRouteSelection(workspaceId, branch, { kind: 'terminal', terminalSessionId }),
          })
        : routeNavigation.openRepoBranchTerminal(workspaceId, branch, terminalSessionId, {
            presentationToken: token,
            onCommit: () =>
              rememberWorkspacePaneRouteSelection(workspaceId, branch, { kind: 'terminal', terminalSessionId }),
          })
      if (!accepted) return false
      return true
    },
    showRepoWorktreeTerminalSession(workspaceId, worktreePath, terminalSessionId, options) {
      const open = routeNavigation.openRepoWorktreeTerminal
      if (!open) return false
      const token = options?.presentationToken ?? beginPrimaryWindowPresentation()
      return open(workspaceId, worktreePath, terminalSessionId, { ...options, presentationToken: token })
    },
    showRepoWorktreeWorkspacePaneTab(workspaceId, worktreePath, tab, options) {
      const open = routeNavigation.openRepoWorktreeTab
      if (!open) return false
      const token = options?.presentationToken ?? beginPrimaryWindowPresentation()
      return open(workspaceId, worktreePath, tab, { ...options, presentationToken: token })
    },
    showWorkspaceRootPaneTab(workspaceId, presentation, options) {
      const token = options?.presentationToken ?? beginPrimaryWindowPresentation()
      const navigationOptions = {
        ...options,
        presentationToken: token,
        onCommit: () => {
          const state = useWorkspacesStore.getState()
          if (!state.workspaces[workspaceId]) return
          if (presentation.kind === 'terminal') {
            state.setSelectedTerminal(
              formatTerminalFilesystemTargetKeyForPath(workspaceId, workspaceId),
              presentation.terminalSessionId,
            )
          }
          state.setWorkspacePaneTabForTarget(
            { kind: 'workspace-root', workspaceId: workspaceId },
            presentation.kind === 'terminal' ? 'terminal' : presentation.tab,
          )
          options?.onCommit?.()
        },
      }
      return presentation.kind === 'terminal'
        ? routeNavigation.openWorkspaceRootTerminal(workspaceId, presentation.terminalSessionId, navigationOptions)
        : routeNavigation.openWorkspaceRootTab(workspaceId, presentation.tab, navigationOptions)
    },
    commitWorkspacePaneRoute(workspaceId, branch, route, options) {
      return commitWorkspacePaneRoute(routeNavigation, workspaceId, branch, route, options)
    },
    goBack(workspaceId) {
      if (workspaceNavigationHistoryRestoreBlocked(workspaceId, 'back')) return
      const canonicalWorkspaceId = useWorkspacesStore.getState().workspaces[workspaceId]?.id
      if (!canonicalWorkspaceId) return
      const presentationToken = beginPrimaryWindowPresentation()
      const traversal = peekWorkspaceNavigation(canonicalWorkspaceId, 'back')
      if (!traversal) return
      const result = restoreWorkspaceNavigationEntry(traversal.target, routeNavigation, { presentationToken })
      if (result.kind === 'accepted') commitWorkspaceNavigation(traversal)
    },
    goForward(workspaceId) {
      if (workspaceNavigationHistoryRestoreBlocked(workspaceId, 'forward')) return
      const canonicalWorkspaceId = useWorkspacesStore.getState().workspaces[workspaceId]?.id
      if (!canonicalWorkspaceId) return
      const presentationToken = beginPrimaryWindowPresentation()
      const traversal = peekWorkspaceNavigation(canonicalWorkspaceId, 'forward')
      if (!traversal) return
      const result = restoreWorkspaceNavigationEntry(traversal.target, routeNavigation, { presentationToken })
      if (result.kind === 'accepted') commitWorkspaceNavigation(traversal)
    },
    openSettings(page) {
      const presentationToken = beginPrimaryWindowPresentation()
      routeNavigation.openSettings(page, { presentationToken })
    },
    openCreateWorktree() {
      if (!currentWorkspaceId) return
      const presentationToken = beginPrimaryWindowPresentation()
      routeNavigation.openRepoNewWorktree(currentWorkspaceId, { presentationToken })
    },
  }
}

type WorkspacePaneRememberedRoute =
  | { kind: 'empty' }
  | { kind: 'static'; tab: WorkspacePaneStaticTabType }
  | { kind: 'terminal'; terminalSessionId: string }

function rememberWorkspacePaneRouteSelection(
  workspaceId: WorkspaceId,
  branchName: string,
  route: WorkspacePaneRememberedRoute,
): void {
  const state = useWorkspacesStore.getState()
  const workspace = state.workspaces[workspaceId]
  const branchModel = workspace?.capability.kind === 'git' ? readRepoBranchSnapshotQueryProjection(workspace) : null
  const branch = branchModel?.branches.find((candidate) => candidate.name === branchName)
  if (!workspace || !branchModel || !branch) return
  state.setWorkspacePaneTab(
    workspaceId,
    branchName,
    route.kind === 'empty' ? null : route.kind === 'static' ? route.tab : 'terminal',
  )
  if (route.kind !== 'terminal') return
  const worktreePath = branch.worktree?.path ?? null
  if (!worktreePath) return
  state.setSelectedTerminal(
    formatTerminalFilesystemTargetKeyForPath(workspaceId, worktreePath),
    route.terminalSessionId,
  )
}

function commitWorkspacePaneRoute(
  routeNavigation: PrimaryWindowRouteNavigation,
  workspaceId: WorkspaceId,
  branchName: string,
  route: WorkspacePaneRouteTarget,
  options?: PrimaryWindowPresentationNavigationOptions,
): MaybePromise<boolean> {
  const token = options?.presentationToken ?? beginPrimaryWindowPresentation()
  if (!primaryWindowPresentationIsCurrent(token)) return false
  const routeOptions = {
    replace: options?.replace,
    presentationToken: token,
    onCommit: options?.onCommit,
    routePrecondition: options?.routePrecondition,
  }
  return routeNavigation.commitWorkspacePaneRoute
    ? routeNavigation.commitWorkspacePaneRoute(workspaceId, branchName, route, routeOptions)
    : openResolvedWorkspacePaneRoute(routeNavigation, workspaceId, branchName, route, routeOptions)
}

function restoreWorkspacePresentationOrOpenDashboard(
  workspaceId: WorkspaceId,
  routeNavigation: PrimaryWindowRouteNavigation,
  presentationToken: PrimaryWindowPresentationToken,
  options: { onBlocked: 'stay' | 'dashboard' },
): void {
  const state = useWorkspacesStore.getState()
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
    const result = restoreWorkspaceNavigationEntry(entry, routeNavigation, { presentationToken })
    if (result.kind === 'accepted' || (result.kind === 'blocked' && options.onBlocked === 'stay')) return
  }
  routeNavigation.openWorkspaceDashboard(workspaceId, { presentationToken })
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
