import type { WorkspacePaneTabType } from '#/shared/workspace-pane.ts'
import type { SettingsPage } from '#/shared/settings-pages.ts'
import type { PrimaryWindowRouteNavigation } from '#/web/primary-window-route-navigation.ts'
import type { WorkspaceNavigationHistoryEntry } from '#/web/stores/repos/types.ts'
import { restoreWorkspaceNavigationEntry } from '#/web/workspace-navigation-history.ts'

export interface PrimaryWindowNavigationActions {
  activateRepo: (repoId: string) => void
  closeRepo: (repoId: string) => void
  cycleRepo: (direction: 1 | -1) => void
  selectRepoBranch: (repoId: string, branch: string) => void
  showRepoBranchWorkspacePaneTab: (repoId: string, branch: string, tab: WorkspacePaneTabType) => void
  goBack: (repoId: string) => void
  goForward: (repoId: string) => void
  openSettings: (page: SettingsPage) => void
  openCreateWorktree: () => void
}

interface CreatePrimaryWindowNavigationActionsOptions {
  currentRepoId: string | null
  order: string[]
  closeRepo: (repoId: string) => void
  setWorkspacePaneTab: (repoId: string, branch: string, tab: WorkspacePaneTabType) => void
  goBackInWorkspaceNavigation?: (repoId: string) => WorkspaceNavigationHistoryEntry | null
  goForwardInWorkspaceNavigation?: (repoId: string) => WorkspaceNavigationHistoryEntry | null
  routeNavigation: PrimaryWindowRouteNavigation
}

export function createPrimaryWindowNavigationActions({
  currentRepoId,
  order,
  closeRepo,
  setWorkspacePaneTab,
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
    selectRepoBranch(repoId, branch) {
      routeNavigation.openRepoBranch(repoId, branch)
    },
    showRepoBranchWorkspacePaneTab(repoId, branch, tab) {
      routeNavigation.openRepoBranch(repoId, branch)
      setWorkspacePaneTab(repoId, branch, tab)
    },
    goBack(repoId) {
      const target = goBackInWorkspaceNavigation?.(repoId) ?? null
      if (target) restoreWorkspaceNavigationEntry(target, routeNavigation)
    },
    goForward(repoId) {
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
