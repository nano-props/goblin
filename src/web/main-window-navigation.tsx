import { createContext, useContext } from 'react'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { SettingsPage } from '#/shared/settings-pages.ts'
import type { DetailTab } from '#/web/stores/repos/types.ts'
export interface MainWindowNavigationActions {
  activateRepo: (repoId: string) => void
  closeRepo: (repoId: string) => void
  cycleRepo: (direction: 1 | -1) => void
  selectRepoBranch: (repoId: string, branch: string) => void
  showRepoDetailTab: (repoId: string, tab: DetailTab) => void
  showRepoBranchDetailTab: (repoId: string, branch: string, tab: DetailTab) => void
  openSettings: (page: SettingsPage) => void
}

const MainWindowNavigationContext = createContext<MainWindowNavigationActions | null>(null)

export const MainWindowNavigationProvider = MainWindowNavigationContext.Provider

export function useMainWindowNavigation(): MainWindowNavigationActions {
  const context = useContext(MainWindowNavigationContext)
  const setActive = useReposStore((s) => s.setActive)
  const closeRepo = useReposStore((s) => s.closeRepo)
  const cycleActive = useReposStore((s) => s.cycleActive)
  const setDetailTab = useReposStore((s) => s.setDetailTab)

  if (context) return context

  return {
    activateRepo: setActive,
    closeRepo,
    cycleRepo: cycleActive,
    selectRepoBranch: (repoId, branch) => {
      setActive(repoId)
      useReposStore.getState().selectBranch(repoId, branch)
    },
    showRepoDetailTab: (repoId, tab) => {
      setActive(repoId)
      setDetailTab(repoId, tab)
    },
    showRepoBranchDetailTab: (repoId, branch, tab) => {
      setActive(repoId)
      const state = useReposStore.getState()
      state.selectBranch(repoId, branch)
      setDetailTab(repoId, tab)
    },
    openSettings: () => {},
  }
}
