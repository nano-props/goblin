import type { WorkspacePaneStaticTabType } from '#/shared/workspace-pane.ts'
import type { SettingsPage } from '#/shared/settings-pages.ts'
import type { PrimaryWindowRouteNavigation } from '#/web/primary-window-route-navigation.ts'
import type { WorkspaceNavigationHistoryEntry } from '#/web/stores/repos/types.ts'
import {
  restoreWorkspaceNavigationEntry,
  workspaceNavigationHistoryRestoreBlocked,
} from '#/web/workspace-navigation-history.ts'
import {
  workspacePanePreferenceTargetOptions,
  workspacePaneTabInteractionBlockedForBranch,
} from '#/web/workspace-pane/workspace-pane-tab-target.ts'

export interface PrimaryWindowNavigationActions {
  activateRepo: (repoId: string) => void
  closeRepo: (repoId: string) => void
  cycleRepo: (direction: 1 | -1) => void
  selectRepoBranch: (repoId: string, branch: string, options?: { replace?: boolean }) => void
  showRepoBranchWorkspacePaneTab: (
    repoId: string,
    branch: string,
    tab: WorkspacePaneStaticTabType,
    options?: { replace?: boolean },
  ) => void
  showRepoBranchTerminalSession: (
    repoId: string,
    branch: string,
    terminalSessionId: string,
    options?: { replace?: boolean },
  ) => void
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
      routeNavigation.openRepoBranch(repoId, branch, options)
    },
    showRepoBranchWorkspacePaneTab(repoId, branch, tab, options) {
      if (workspacePaneTabInteractionBlockedForBranch(repoId, branch, workspacePanePreferenceTargetOptions)) return
      if (options) routeNavigation.openRepoBranchTab(repoId, branch, tab, options)
      else routeNavigation.openRepoBranchTab(repoId, branch, tab)
    },
    showRepoBranchTerminalSession(repoId, branch, terminalSessionId, options) {
      if (workspacePaneTabInteractionBlockedForBranch(repoId, branch, workspacePanePreferenceTargetOptions)) return
      if (options) routeNavigation.openRepoBranchTerminal(repoId, branch, terminalSessionId, options)
      else routeNavigation.openRepoBranchTerminal(repoId, branch, terminalSessionId)
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
