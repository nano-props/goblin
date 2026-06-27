import type { WorkspacePaneTabType } from '#/shared/workspace-pane.ts'
import type { SettingsPage } from '#/shared/settings-pages.ts'

export interface MainWindowNavigationActions {
  activateRepo: (repoId: string) => void
  closeRepo: (repoId: string) => void
  cycleRepo: (direction: 1 | -1) => void
  selectRepoBranch: (repoId: string, branch: string) => void
  showRepoWorkspacePaneView: (repoId: string, tab: WorkspacePaneTabType) => void
  showRepoBranchWorkspacePaneView: (repoId: string, branch: string, tab: WorkspacePaneTabType) => void
  openSettings: (page: SettingsPage) => void
}

interface CreateMainWindowNavigationActionsOptions {
  activeId: string | null
  order: string[]
  setActive: (repoId: string) => void
  closeRepo: (repoId: string) => void
  cycleActive: (direction: 1 | -1) => void
  selectBranch: (repoId: string, branch: string) => void
  setWorkspacePaneTab: (repoId: string, tab: WorkspacePaneTabType) => void
  onOpenSettings?: (page: SettingsPage) => void
}

export function createMainWindowNavigationActions({
  activeId,
  order,
  setActive,
  closeRepo,
  cycleActive,
  selectBranch,
  setWorkspacePaneTab,
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
    showRepoWorkspacePaneView(repoId, tab) {
      if (repoId !== activeId) setActive(repoId)
      setWorkspacePaneTab(repoId, tab)
    },
    showRepoBranchWorkspacePaneView(repoId, branch, tab) {
      if (repoId !== activeId) setActive(repoId)
      selectBranch(repoId, branch)
      setWorkspacePaneTab(repoId, tab)
    },
    openSettings(page) {
      onOpenSettings?.(page)
    },
  }
}
