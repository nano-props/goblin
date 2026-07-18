import type { WorkspacePaneStaticTabType } from '#/shared/workspace-pane.ts'
import type { SettingsPage } from '#/shared/settings-pages.ts'
import type { WorkspacePaneRouteTarget } from '#/web/App.tsx'
import type { PrimaryWindowRouteNavigation } from '#/web/primary-window-route-navigation.ts'
import type { CloseRepoResult, WorkspaceNavigationHistoryTraversal } from '#/web/stores/repos/types.ts'
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

export interface PrimaryWindowNavigationActions {
  activateRepo: (repoId: string) => void
  closeRepo: (repoId: string) => Promise<CloseRepoResult>
  cycleRepo: (direction: 1 | -1) => void
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
    options?: { replace?: boolean },
  ) => boolean
  showRepoWorktreeWorkspacePaneTab?: (
    repoId: string,
    worktreePath: string,
    tab: WorkspacePaneStaticTabType,
    options?: { replace?: boolean },
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
  currentRepoId: string | null
  order: string[]
  closeRepo: (repoId: string) => Promise<CloseRepoResult>
  peekWorkspaceNavigation: (repoId: string, direction: 'back' | 'forward') => WorkspaceNavigationHistoryTraversal | null
  commitWorkspaceNavigation: (traversal: WorkspaceNavigationHistoryTraversal) => boolean
  routeNavigation: PrimaryWindowRouteNavigation
}

export function createPrimaryWindowNavigationActions({
  currentRepoId,
  order,
  closeRepo,
  peekWorkspaceNavigation,
  commitWorkspaceNavigation,
  routeNavigation,
}: CreatePrimaryWindowNavigationActionsOptions): PrimaryWindowNavigationActions {
  return {
    currentWorkspacePaneRoute(repoId, branchName) {
      return routeNavigation.currentWorkspacePaneRoute(repoId, branchName)
    },
    activateRepo(repoId) {
      const presentationToken = beginPrimaryWindowPresentation()
      restoreRepoPresentationOrOpenDashboard(repoId, routeNavigation, presentationToken, { onBlocked: 'stay' })
    },
    async closeRepo(repoId) {
      const nextRepoId = repoId === currentRepoId ? nextNavigationRepoIdAfterClose(order, repoId) : null
      const presentationToken = repoId === currentRepoId ? beginPrimaryWindowPresentation() : null
      const result = await closeRepo(repoId)
      if (!result.ok || repoId !== currentRepoId) return result
      if (nextRepoId)
        restoreRepoPresentationOrOpenDashboard(nextRepoId, routeNavigation, presentationToken!, {
          onBlocked: 'dashboard',
        })
      else routeNavigation.openHome({ presentationToken: presentationToken! })
      return result
    },
    cycleRepo(direction) {
      const repoId = nextNavigationRepoId(order, currentRepoId, direction)
      if (repoId) {
        const presentationToken = beginPrimaryWindowPresentation()
        restoreRepoPresentationOrOpenDashboard(repoId, routeNavigation, presentationToken, { onBlocked: 'stay' })
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
      const token = beginPrimaryWindowPresentation()
      return open(repoId, worktreePath, terminalSessionId, { ...options, presentationToken: token })
    },
    showRepoWorktreeWorkspacePaneTab(repoId, worktreePath, tab, options) {
      const open = routeNavigation.openRepoWorktreeTab
      if (!open) return false
      const token = beginPrimaryWindowPresentation()
      return open(repoId, worktreePath, tab, { ...options, presentationToken: token })
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
      if (!currentRepoId) return
      const presentationToken = beginPrimaryWindowPresentation()
      routeNavigation.openRepoNewWorktree(currentRepoId, { presentationToken })
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

function restoreRepoPresentationOrOpenDashboard(
  repoId: string,
  routeNavigation: PrimaryWindowRouteNavigation,
  presentationToken: PrimaryWindowPresentationToken,
  options: { onBlocked: 'stay' | 'dashboard' },
): void {
  const state = useReposStore.getState()
  const repo = state.repos[repoId]
  if (workspaceGitUnavailable(repo?.workspaceProbe)) {
    routeNavigation.openRepoDashboard(repoId, { presentationToken })
    return
  }
  const entry = state.navigationHistoryByRepo[repoId]?.current ?? null
  // Creating a worktree is a transient workflow, not a repo workspace to resume.
  if (entry && entry.route.kind !== 'newWorktree') {
    const result = restoreWorkspaceNavigationEntry(entry, routeNavigation, { presentationToken })
    if (result.kind === 'accepted' || (result.kind === 'blocked' && options.onBlocked === 'stay')) return
  }
  routeNavigation.openRepoDashboard(repoId, { presentationToken })
}

function nextNavigationRepoIdAfterClose(order: string[], closingRepoId: string): string | null {
  const currentIndex = order.indexOf(closingRepoId)
  if (currentIndex === -1) return order[0] ?? null
  return order[currentIndex + 1] ?? order[currentIndex - 1] ?? null
}

function nextNavigationRepoId(order: string[], currentRepoId: string | null, direction: 1 | -1): string | null {
  if (order.length === 0) return null
  if (!currentRepoId) return order[0] ?? null
  const currentIndex = order.indexOf(currentRepoId)
  if (currentIndex === -1) return order[0] ?? null
  return order[(currentIndex + direction + order.length) % order.length] ?? null
}
