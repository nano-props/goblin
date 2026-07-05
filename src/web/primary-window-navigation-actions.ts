import type { WorkspacePaneTabType } from '#/shared/workspace-pane.ts'
import type { SettingsPage } from '#/shared/settings-pages.ts'
import type { PrimaryWindowRouteNavigation } from '#/web/primary-window-route-navigation.ts'

export interface PrimaryWindowNavigationActions {
  activateRepo: (repoId: string) => void
  closeRepo: (repoId: string) => void
  cycleRepo: (direction: 1 | -1) => void
  selectRepoBranch: (repoId: string, branch: string) => void
  showRepoBranchWorkspacePaneTab: (repoId: string, branch: string, tab: WorkspacePaneTabType) => void
  openSettings: (page: SettingsPage) => void
  openCreateWorktree: () => void
}

interface CreatePrimaryWindowNavigationActionsOptions {
  currentRepoId: string | null
  order: string[]
  closeRepo: (repoId: string) => void
  setWorkspacePaneTab: (repoId: string, branch: string, tab: WorkspacePaneTabType) => void
  routeNavigation: PrimaryWindowRouteNavigation
}

export function createPrimaryWindowNavigationActions({
  currentRepoId,
  order,
  closeRepo,
  setWorkspacePaneTab,
  routeNavigation,
}: CreatePrimaryWindowNavigationActionsOptions): PrimaryWindowNavigationActions {
  return {
    activateRepo(repoId) {
      routeNavigation.openRepoDashboard(repoId)
    },
    closeRepo(repoId) {
      closeRepo(repoId)
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
    openSettings(page) {
      routeNavigation.openSettings(page)
    },
    openCreateWorktree() {
      if (!currentRepoId) return
      routeNavigation.openRepoNewWorktree(currentRepoId)
    },
  }
}

function nextNavigationRepoId(order: string[], currentRepoId: string | null, direction: 1 | -1): string | null {
  if (order.length === 0) return null
  if (!currentRepoId) return order[0] ?? null
  const currentIndex = order.indexOf(currentRepoId)
  if (currentIndex === -1) return order[0] ?? null
  return order[(currentIndex + direction + order.length) % order.length] ?? null
}
