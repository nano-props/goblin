import type { DetailTab } from '#/web/stores/repos/types.ts'
import type { SettingsPage } from '#/shared/settings-pages.ts'

export interface MainWindowNavigationActions {
  activateRepo: (repoId: string) => void
  closeRepo: (repoId: string) => void
  cycleRepo: (direction: 1 | -1) => void
  selectRepoBranch: (repoId: string, branch: string) => void
  showRepoDetailTab: (repoId: string, tab: DetailTab) => void
  showRepoBranchDetailTab: (repoId: string, branch: string, tab: DetailTab) => void
  openSettings: (page: SettingsPage) => void
}

interface CreateMainWindowNavigationActionsOptions {
  activeId: string | null
  order: string[]
  setActive: (repoId: string) => void
  closeRepo: (repoId: string) => void
  cycleActive: (direction: 1 | -1) => void
  selectBranch: (repoId: string, branch: string) => void
  setDetailTab: (repoId: string, tab: DetailTab) => void
  onOpenSettings?: (page: SettingsPage) => void
}

export function createMainWindowNavigationActions({
  activeId,
  order,
  setActive,
  closeRepo,
  cycleActive,
  selectBranch,
  setDetailTab,
  onOpenSettings,
}: CreateMainWindowNavigationActionsOptions): MainWindowNavigationActions {
  return {
    activateRepo(repoId) {
      setActive(repoId)
    },
    closeRepo(repoId) {
      closeRepo(repoId)
    },
    cycleRepo(direction) {
      cycleActive(direction)
    },
    selectRepoBranch(repoId, branch) {
      if (repoId !== activeId) setActive(repoId)
      selectBranch(repoId, branch)
    },
    showRepoDetailTab(repoId, tab) {
      if (repoId !== activeId) setActive(repoId)
      setDetailTab(repoId, tab)
    },
    showRepoBranchDetailTab(repoId, branch, tab) {
      if (repoId !== activeId) setActive(repoId)
      selectBranch(repoId, branch)
      setDetailTab(repoId, tab)
    },
    openSettings(page) {
      onOpenSettings?.(page)
    },
  }
}
