import type { WorkspacePaneStaticTabType } from '#/shared/workspace-pane.ts'
import type { SettingsPage } from '#/shared/settings-pages.ts'
import type { RepoBranchWorkspacePaneRoute } from '#/web/App.tsx'
import type { PrimaryWindowRouteNavigation } from '#/web/primary-window-route-navigation.ts'
import type { WorkspaceNavigationHistoryEntry } from '#/web/stores/repos/types.ts'
import {
  restoreWorkspaceNavigationEntry,
  workspaceNavigationHistoryRestoreBlocked,
} from '#/web/workspace-navigation-history.ts'
import { workspacePaneRouteNavigationBlockedForBranch } from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import { openRepoBranchWorkspacePaneRoute } from '#/web/workspace-pane/repo-branch-workspace-pane-route.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { readRepoBranchQueryProjection } from '#/web/repo-branch-read-model.ts'
import { formatTerminalWorktreeKey } from '#/shared/terminal-worktree-key.ts'

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
  commitRepoBranchWorkspacePaneRoute?: (
    repoId: string,
    branch: string,
    route: RepoBranchWorkspacePaneRoute | null,
    options?: { replace?: boolean },
  ) => boolean
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
      routeNavigation.openRepoDashboard(repoId)
    },
    closeRepo(repoId) {
      const nextRepoId = repoId === currentRepoId ? nextNavigationRepoIdAfterClose(order, repoId) : null
      closeRepo(repoId)
      if (repoId !== currentRepoId) return
      if (nextRepoId) routeNavigation.openRepoDashboard(nextRepoId)
      else routeNavigation.openHome()
    },
    cycleRepo(direction) {
      const repoId = nextNavigationRepoId(order, currentRepoId, direction)
      if (repoId) routeNavigation.openRepoDashboard(repoId)
    },
    selectRepoBranch(repoId, branch, options) {
      return openRepoBranchWorkspacePaneRoute(routeNavigation, repoId, branch, options)
    },
    showRepoBranchEmptyWorkspacePane(repoId, branch, options) {
      if (!routeNavigation.openRepoBranch(repoId, branch, options)) return false
      rememberWorkspacePaneRouteSelection(repoId, branch, { kind: 'empty' })
      return true
    },
    showRepoBranchWorkspacePaneTab(repoId, branch, tab, options) {
      if (workspacePaneRouteNavigationBlockedForBranch(repoId, branch)) return false
      const accepted = options
        ? routeNavigation.openRepoBranchTab(repoId, branch, tab, options)
        : routeNavigation.openRepoBranchTab(repoId, branch, tab)
      if (!accepted) return false
      rememberWorkspacePaneRouteSelection(repoId, branch, { kind: 'static', tab })
      return true
    },
    showRepoBranchTerminalSession(repoId, branch, terminalSessionId, options) {
      if (workspacePaneRouteNavigationBlockedForBranch(repoId, branch)) return false
      const accepted = options
        ? routeNavigation.openRepoBranchTerminal(repoId, branch, terminalSessionId, options)
        : routeNavigation.openRepoBranchTerminal(repoId, branch, terminalSessionId)
      if (!accepted) return false
      rememberWorkspacePaneRouteSelection(repoId, branch, { kind: 'terminal', terminalSessionId })
      return true
    },
    commitRepoBranchWorkspacePaneRoute(repoId, branch, route, options) {
      return commitRepoBranchWorkspacePaneRoute(routeNavigation, repoId, branch, route, options)
    },
    goBack(repoId) {
      if (workspaceNavigationHistoryRestoreBlocked(repoId, 'back')) return
      const target = goBackInWorkspaceNavigation?.(repoId) ?? null
      if (target) restoreWorkspaceNavigationEntry(target, routeNavigation)
    },
    goForward(repoId) {
      if (workspaceNavigationHistoryRestoreBlocked(repoId, 'forward')) return
      const target = goForwardInWorkspaceNavigation?.(repoId) ?? null
      if (target) restoreWorkspaceNavigationEntry(target, routeNavigation)
    },
    openSettings(page) {
      routeNavigation.openSettings(page)
    },
    openCreateWorktree() {
      if (!currentRepoId) return
      routeNavigation.openRepoNewWorktree(currentRepoId)
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
  route: RepoBranchWorkspacePaneRoute | null,
  options?: { replace?: boolean },
): boolean {
  if (route === null) {
    if (!routeNavigation.openRepoBranch(repoId, branchName, options)) return false
    rememberWorkspacePaneRouteSelection(repoId, branchName, { kind: 'empty' })
    return true
  }
  if (route.kind === 'static') {
    if (!routeNavigation.openRepoBranchTab(repoId, branchName, route.tab, options)) return false
    rememberWorkspacePaneRouteSelection(repoId, branchName, { kind: 'static', tab: route.tab })
    return true
  }
  if (route.kind === 'terminal') {
    if (!routeNavigation.openRepoBranchTerminal(repoId, branchName, route.terminalSessionId, options)) return false
    rememberWorkspacePaneRouteSelection(repoId, branchName, {
      kind: 'terminal',
      terminalSessionId: route.terminalSessionId,
    })
    return true
  }
  return false
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
