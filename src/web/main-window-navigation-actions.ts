import type { WorkspacePaneView } from '#/shared/workspace-pane.ts'
import type { SettingsPage } from '#/shared/settings-pages.ts'
import type { CompactWorkspacePane } from '#/web/stores/repos/types.ts'

export interface MainWindowNavigationActions {
  activateRepo: (repoId: string) => void
  closeRepo: (repoId: string) => void
  cycleRepo: (direction: 1 | -1) => void
  selectRepoBranch: (repoId: string, branch: string) => void
  showRepoWorkspacePaneView: (repoId: string, tab: WorkspacePaneView) => void
  showRepoBranchWorkspacePaneView: (repoId: string, branch: string, tab: WorkspacePaneView) => void
  openSettings: (page: SettingsPage) => void
}

interface CreateMainWindowNavigationActionsOptions {
  activeId: string | null
  order: string[]
  setActive: (repoId: string) => void
  closeRepo: (repoId: string) => void
  cycleActive: (direction: 1 | -1) => void
  selectBranch: (repoId: string, branch: string) => void
  setWorkspacePaneView: (repoId: string, tab: WorkspacePaneView) => void
  setCompactWorkspacePane?: (pane: CompactWorkspacePane) => void
  onOpenSettings?: (page: SettingsPage) => void
}

export function createMainWindowNavigationActions({
  activeId,
  order,
  setActive,
  closeRepo,
  cycleActive,
  selectBranch,
  setWorkspacePaneView,
  setCompactWorkspacePane,
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
      setWorkspacePaneView(repoId, tab)
      setCompactWorkspacePane?.('workspace')
    },
    showRepoBranchWorkspacePaneView(repoId, branch, tab) {
      if (repoId !== activeId) setActive(repoId)
      selectBranch(repoId, branch)
      setWorkspacePaneView(repoId, tab)
      setCompactWorkspacePane?.('workspace')
    },
    openSettings(page) {
      onOpenSettings?.(page)
    },
  }
}
