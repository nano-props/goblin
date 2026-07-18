import type { WorkspacePaneStaticTabType } from '#/shared/workspace-pane.ts'
import type { SettingsPage } from '#/shared/settings-pages.ts'
import type { WorkspacePaneRouteTarget } from '#/web/App.tsx'
import type { PrimaryWindowRouteNavigation } from '#/web/primary-window-route-navigation.ts'
import type { CloseWorkspaceResult, WorkspaceNavigationHistoryTraversal } from '#/web/stores/repos/types.ts'
import {
  restoreWorkspaceNavigationEntry,
  workspaceNavigationHistoryRestoreBlocked,
} from '#/web/workspace-navigation-history.ts'
import { workspacePaneRouteNavigationBlockedForBranch } from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import { openWorkspacePaneRoute } from '#/web/workspace-pane/repo-branch-workspace-pane-route.ts'
import { openResolvedWorkspacePaneRoute } from '#/web/workspace-pane/repo-branch-workspace-pane-route-navigation.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { readRepoBranchSnapshotQueryProjection } from '#/web/repo-branch-read-model.ts'
import { formatTerminalWorktreeKeyForPath } from '#/shared/terminal-worktree-key.ts'
import {
  beginPrimaryWindowPresentation,
  primaryWindowPresentationIsCurrent,
  type PrimaryWindowPresentationToken,
} from '#/web/primary-window-presentation.ts'
import { workspaceGitUnavailable } from '#/shared/workspace-runtime.ts'

type MaybePromise<T> = T | Promise<T>

export interface PrimaryWindowPresentationNavigationOptions {
  replace?: boolean
  presentationToken?: PrimaryWindowPresentationToken
  onCommit?: () => void
  routePrecondition?:
    { kind: 'exact-route'; route: WorkspacePaneRouteTarget } | { kind: 'current-workspace-target' }
}

export type WorkspaceRootPanePresentation =
  | { kind: 'static'; tab: WorkspacePaneStaticTabType }
  | { kind: 'terminal'; terminalSessionId: string }

export interface PrimaryWindowNavigationActions {
  activateWorkspace: (workspaceId: string) => void
  closeWorkspace: (workspaceId: string) => Promise<CloseWorkspaceResult>
  cycleWorkspace: (direction: 1 | -1) => void
  selectRepoBranch: (repoId: string, branch: string, options?: { replace?: boolean }) => boolean
  showRepoBranchEmptyWorkspacePane: (repoId: string, branch: string, options?: { replace?: boolean }) => boolean
  showRepoBranchWorkspacePaneTab: (
    repoId: string,
    branch: string,
    tab: WorkspacePaneStaticTabType,
    options?: { replace?: boolean },
  ) => boolean
  showRepoBranchTerminalSession: (
    repoId: string,
    branch: string,
    terminalSessionId: string,
    options?: { replace?: boolean },
  ) => boolean
  showRepoWorktreeTerminalSession?: (
    repoId: string,
    worktreePath: string,
    terminalSessionId: string,
    options?: PrimaryWindowPresentationNavigationOptions,
  ) => boolean
  showRepoWorktreeWorkspacePaneTab?: (
    repoId: string,
    worktreePath: string,
    tab: WorkspacePaneStaticTabType,
    options?: PrimaryWindowPresentationNavigationOptions,
  ) => boolean
  showWorkspaceRootPaneTab?: (
    workspaceId: string,
    presentation: WorkspaceRootPanePresentation,
    options?: PrimaryWindowPresentationNavigationOptions,
  ) => boolean
  commitWorkspacePaneRoute: (
    repoId: string,
    branch: string,
    route: WorkspacePaneRouteTarget,
    options?: PrimaryWindowPresentationNavigationOptions,
  ) => MaybePromise<boolean>
  currentWorkspacePaneRoute: (
    repoId: string,
    branch: string,
  ) => WorkspacePaneRouteTarget | undefined
  goBack: (repoId: string) => void
  goForward: (repoId: string) => void
  openSettings: (page: SettingsPage) => void
  openCreateWorktree: () => void
}

interface CreatePrimaryWindowNavigationActionsOptions {
  currentWorkspaceId: string | null
  order: string[]
  closeWorkspace: (workspaceId: string) => Promise<CloseWorkspaceResult>
  peekWorkspaceNavigation: (repoId: string, direction: 'back' | 'forward') => WorkspaceNavigationHistoryTraversal | null
  commitWorkspaceNavigation: (traversal: WorkspaceNavigationHistoryTraversal) => boolean
  routeNavigation: PrimaryWindowRouteNavigation
}

export function createPrimaryWindowNavigationActions({
  currentWorkspaceId,
  order,
  closeWorkspace,
  peekWorkspaceNavigation,
  commitWorkspaceNavigation,
  routeNavigation,
}: CreatePrimaryWindowNavigationActionsOptions): PrimaryWindowNavigationActions {
  return {
    currentWorkspacePaneRoute(repoId, branchName) {
      return routeNavigation.currentWorkspacePaneRoute(repoId, branchName)
    },
    activateWorkspace(workspaceId) {
      const presentationToken = beginPrimaryWindowPresentation()
      restoreWorkspacePresentationOrOpenDashboard(workspaceId, routeNavigation, presentationToken, {
        onBlocked: 'stay',
      })
    },
    async closeWorkspace(workspaceId) {
      const nextWorkspaceId = workspaceId === currentWorkspaceId ? nextWorkspaceIdAfterClose(order, workspaceId) : null
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
      const workspaceId = nextNavigationWorkspaceId(order, currentWorkspaceId, direction)
      if (workspaceId) {
        const presentationToken = beginPrimaryWindowPresentation()
        restoreWorkspacePresentationOrOpenDashboard(workspaceId, routeNavigation, presentationToken, {
          onBlocked: 'stay',
        })
      }
    },
    selectRepoBranch(repoId, branch, options) {
      const presentationToken = beginPrimaryWindowPresentation()
      return openWorkspacePaneRoute(routeNavigation, repoId, branch, { ...options, presentationToken })
    },
    showRepoBranchEmptyWorkspacePane(repoId, branch, options) {
      const token = beginPrimaryWindowPresentation()
      return routeNavigation.openRepoBranch(repoId, branch, {
        ...options,
        presentationToken: token,
        onCommit: () => rememberWorkspacePaneRouteSelection(repoId, branch, { kind: 'empty' }),
      })
    },
    showRepoBranchWorkspacePaneTab(repoId, branch, tab, options) {
      if (workspacePaneRouteNavigationBlockedForBranch(repoId, branch)) return false
      const token = beginPrimaryWindowPresentation()
      const onCommit = () => rememberWorkspacePaneRouteSelection(repoId, branch, { kind: 'static' as const, tab })
      const accepted = options
        ? routeNavigation.openRepoBranchTab(repoId, branch, tab, { ...options, presentationToken: token, onCommit })
        : routeNavigation.openRepoBranchTab(repoId, branch, tab, {
            presentationToken: token,
            onCommit,
          })
      if (!accepted) return false
      return true
    },
    showRepoBranchTerminalSession(repoId, branch, terminalSessionId, options) {
      if (workspacePaneRouteNavigationBlockedForBranch(repoId, branch)) return false
      const token = beginPrimaryWindowPresentation()
      const accepted = options
        ? routeNavigation.openRepoBranchTerminal(repoId, branch, terminalSessionId, {
            ...options,
            presentationToken: token,
            onCommit: () =>
              rememberWorkspacePaneRouteSelection(repoId, branch, { kind: 'terminal', terminalSessionId }),
          })
        : routeNavigation.openRepoBranchTerminal(repoId, branch, terminalSessionId, {
            presentationToken: token,
            onCommit: () =>
              rememberWorkspacePaneRouteSelection(repoId, branch, { kind: 'terminal', terminalSessionId }),
          })
      if (!accepted) return false
      return true
    },
    showRepoWorktreeTerminalSession(repoId, worktreePath, terminalSessionId, options) {
      const open = routeNavigation.openRepoWorktreeTerminal
      if (!open) return false
      const token = options?.presentationToken ?? beginPrimaryWindowPresentation()
      return open(repoId, worktreePath, terminalSessionId, { ...options, presentationToken: token })
    },
    showRepoWorktreeWorkspacePaneTab(repoId, worktreePath, tab, options) {
      const open = routeNavigation.openRepoWorktreeTab
      if (!open) return false
      const token = options?.presentationToken ?? beginPrimaryWindowPresentation()
      return open(repoId, worktreePath, tab, { ...options, presentationToken: token })
    },
    showWorkspaceRootPaneTab(repoId, presentation, options) {
      const token = options?.presentationToken ?? beginPrimaryWindowPresentation()
      return routeNavigation.openWorkspaceRootPane(repoId, {
        ...options,
        presentationToken: token,
        onCommit: () => {
          const state = useReposStore.getState()
          if (!state.repos[repoId]) return
          if (presentation.kind === 'terminal') {
            state.setSelectedTerminal(
              formatTerminalWorktreeKeyForPath(repoId, repoId),
              presentation.terminalSessionId,
            )
          }
          state.setWorkspacePaneTabForTarget(
            { kind: 'workspace-root', repoRoot: repoId },
            presentation.kind === 'terminal' ? 'terminal' : presentation.tab,
          )
          options?.onCommit?.()
        },
      })
    },
    commitWorkspacePaneRoute(repoId, branch, route, options) {
      return commitWorkspacePaneRoute(routeNavigation, repoId, branch, route, options)
    },
    goBack(repoId) {
      if (workspaceNavigationHistoryRestoreBlocked(repoId, 'back')) return
      const presentationToken = beginPrimaryWindowPresentation()
      const traversal = peekWorkspaceNavigation(repoId, 'back')
      if (!traversal) return
      const result = restoreWorkspaceNavigationEntry(traversal.target, routeNavigation, { presentationToken })
      if (result.kind === 'accepted') commitWorkspaceNavigation(traversal)
    },
    goForward(repoId) {
      if (workspaceNavigationHistoryRestoreBlocked(repoId, 'forward')) return
      const presentationToken = beginPrimaryWindowPresentation()
      const traversal = peekWorkspaceNavigation(repoId, 'forward')
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
  repoId: string,
  branchName: string,
  route: WorkspacePaneRememberedRoute,
): void {
  const state = useReposStore.getState()
  const repo = state.repos[repoId]
  const branchModel = repo ? readRepoBranchSnapshotQueryProjection(repo) : null
  const branch = branchModel?.branches.find((candidate) => candidate.name === branchName)
  if (!repo || !branchModel || !branch) return
  state.setWorkspacePaneTab(
    repoId,
    branchName,
    route.kind === 'empty' ? null : route.kind === 'static' ? route.tab : 'terminal',
  )
  if (route.kind !== 'terminal') return
  const worktreePath = branch.worktree?.path ?? null
  if (!worktreePath) return
  state.setSelectedTerminal(formatTerminalWorktreeKeyForPath(repoId, worktreePath), route.terminalSessionId)
}

function commitWorkspacePaneRoute(
  routeNavigation: PrimaryWindowRouteNavigation,
  repoId: string,
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
    ? routeNavigation.commitWorkspacePaneRoute(repoId, branchName, route, routeOptions)
    : openResolvedWorkspacePaneRoute(routeNavigation, repoId, branchName, route, routeOptions)
}

function restoreWorkspacePresentationOrOpenDashboard(
  repoId: string,
  routeNavigation: PrimaryWindowRouteNavigation,
  presentationToken: PrimaryWindowPresentationToken,
  options: { onBlocked: 'stay' | 'dashboard' },
): void {
  const state = useReposStore.getState()
  const repo = state.repos[repoId]
  const entry = state.navigationHistoryByRepo[repoId]?.current ?? null
  // Creating a worktree is a transient workflow, not a repo workspace to resume.
  // A non-Git workspace may resume only capability-invariant presentations;
  // stale Git-scoped history must not prevent picker activation.
  const entryCanResume =
    entry &&
    entry.route.kind !== 'newWorktree' &&
    (!workspaceGitUnavailable(repo?.workspaceProbe) ||
      entry.route.kind === 'workspace-root' ||
      entry.route.kind === 'dashboard')
  if (entryCanResume) {
    const result = restoreWorkspaceNavigationEntry(entry, routeNavigation, { presentationToken })
    if (result.kind === 'accepted' || (result.kind === 'blocked' && options.onBlocked === 'stay')) return
  }
  routeNavigation.openRepoDashboard(repoId, { presentationToken })
}

function nextWorkspaceIdAfterClose(order: string[], closingWorkspaceId: string): string | null {
  const currentIndex = order.indexOf(closingWorkspaceId)
  if (currentIndex === -1) return order[0] ?? null
  return order[currentIndex + 1] ?? order[currentIndex - 1] ?? null
}

function nextNavigationWorkspaceId(
  order: string[],
  currentWorkspaceId: string | null,
  direction: 1 | -1,
): string | null {
  if (order.length === 0) return null
  if (!currentWorkspaceId) return order[0] ?? null
  const currentIndex = order.indexOf(currentWorkspaceId)
  if (currentIndex === -1) return order[0] ?? null
  return order[(currentIndex + direction + order.length) % order.length] ?? null
}
