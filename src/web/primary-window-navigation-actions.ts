import type { WorkspacePaneStaticTabType } from '#/shared/workspace-pane.ts'
import type { SettingsPage } from '#/shared/settings-pages.ts'
import type { RepoBranchWorkspacePaneRouteTarget } from '#/web/App.tsx'
import type { PrimaryWindowRouteNavigation } from '#/web/primary-window-route-navigation.ts'
import type { WorkspaceNavigationHistoryEntry } from '#/web/stores/repos/types.ts'
import {
  restoreWorkspaceNavigationEntry,
  workspaceNavigationHistoryRestoreBlocked,
} from '#/web/workspace-navigation-history.ts'
import { workspacePaneRouteNavigationBlockedForBranch } from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import { openRepoBranchWorkspacePaneRoute } from '#/web/workspace-pane/repo-branch-workspace-pane-route.ts'
import { openResolvedRepoBranchWorkspacePaneRoute } from '#/web/workspace-pane/repo-branch-workspace-pane-route-navigation.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { readRepoBranchQueryProjection } from '#/web/repo-branch-read-model.ts'
import { formatTerminalWorktreeKey } from '#/shared/terminal-worktree-key.ts'
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
}

export interface PrimaryWindowNavigationActions {
  activateRepo: (repoId: string) => void
  closeRepo: (repoId: string) => void
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
  commitRepoBranchWorkspacePaneRoute: (
    repoId: string,
    branch: string,
    route: RepoBranchWorkspacePaneRouteTarget,
    options?: PrimaryWindowPresentationNavigationOptions,
  ) => MaybePromise<boolean>
  goBack: (repoId: string) => void
  goForward: (repoId: string) => void
  openSettings: (page: SettingsPage) => void
  openCreateWorktree: () => void
}

interface CreatePrimaryWindowNavigationActionsOptions {
  currentRepoId: string | null
  order: string[]
  closeRepo: (repoId: string) => void
  goBackInWorkspaceNavigation?: (repoId: string) => WorkspaceNavigationHistoryEntry | null
  goForwardInWorkspaceNavigation?: (repoId: string) => WorkspaceNavigationHistoryEntry | null
  routeNavigation: PrimaryWindowRouteNavigation
}

export function createPrimaryWindowNavigationActions({
  currentRepoId,
  order,
  closeRepo,
  goBackInWorkspaceNavigation,
  goForwardInWorkspaceNavigation,
  routeNavigation,
}: CreatePrimaryWindowNavigationActionsOptions): PrimaryWindowNavigationActions {
  return {
    activateRepo(repoId) {
      const presentationToken = beginPrimaryWindowPresentation()
      routeNavigation.openRepoDashboard(repoId, { presentationToken })
    },
    closeRepo(repoId) {
      const nextRepoId = repoId === currentRepoId ? nextNavigationRepoIdAfterClose(order, repoId) : null
      const presentationToken = repoId === currentRepoId ? beginPrimaryWindowPresentation() : null
      closeRepo(repoId)
      if (repoId !== currentRepoId) return
      if (nextRepoId) routeNavigation.openRepoDashboard(nextRepoId, { presentationToken: presentationToken! })
      else routeNavigation.openHome({ presentationToken: presentationToken! })
    },
    cycleRepo(direction) {
      const repoId = nextNavigationRepoId(order, currentRepoId, direction)
      if (repoId) {
        const presentationToken = beginPrimaryWindowPresentation()
        routeNavigation.openRepoDashboard(repoId, { presentationToken })
      }
    },
    selectRepoBranch(repoId, branch, options) {
      const presentationToken = beginPrimaryWindowPresentation()
      return openRepoBranchWorkspacePaneRoute(routeNavigation, repoId, branch, { ...options, presentationToken })
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
    commitRepoBranchWorkspacePaneRoute(repoId, branch, route, options) {
      return commitRepoBranchWorkspacePaneRoute(routeNavigation, repoId, branch, route, options)
    },
    goBack(repoId) {
      if (workspaceNavigationHistoryRestoreBlocked(repoId, 'back')) return
      const presentationToken = beginPrimaryWindowPresentation()
      const target = goBackInWorkspaceNavigation?.(repoId) ?? null
      if (target) restoreWorkspaceNavigationEntry(target, routeNavigation, { presentationToken })
    },
    goForward(repoId) {
      if (workspaceNavigationHistoryRestoreBlocked(repoId, 'forward')) return
      const presentationToken = beginPrimaryWindowPresentation()
      const target = goForwardInWorkspaceNavigation?.(repoId) ?? null
      if (target) restoreWorkspaceNavigationEntry(target, routeNavigation, { presentationToken })
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
  const branchModel = repo ? readRepoBranchQueryProjection(repo) : null
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
  state.setSelectedTerminal(formatTerminalWorktreeKey(repoId, worktreePath), route.terminalSessionId)
}

function commitRepoBranchWorkspacePaneRoute(
  routeNavigation: PrimaryWindowRouteNavigation,
  repoId: string,
  branchName: string,
  route: RepoBranchWorkspacePaneRouteTarget,
  options?: PrimaryWindowPresentationNavigationOptions,
): MaybePromise<boolean> {
  const token = options?.presentationToken ?? beginPrimaryWindowPresentation()
  if (!primaryWindowPresentationIsCurrent(token)) return false
  const routeOptions = { replace: options?.replace, presentationToken: token, onCommit: options?.onCommit }
  return routeNavigation.commitRepoBranchWorkspacePaneRoute
    ? routeNavigation.commitRepoBranchWorkspacePaneRoute(repoId, branchName, route, routeOptions)
    : openResolvedRepoBranchWorkspacePaneRoute(routeNavigation, repoId, branchName, route, routeOptions)
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
