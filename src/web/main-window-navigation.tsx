import { createContext, useContext, useMemo } from 'react'
import { useReposStore } from '#/web/stores/repos/store.ts'
import {
  createMainWindowNavigationActions,
  type MainWindowNavigationActions,
} from '#/web/main-window-navigation-actions.ts'
export type { MainWindowNavigationActions } from '#/web/main-window-navigation-actions.ts'

const MainWindowNavigationContext = createContext<MainWindowNavigationActions | null>(null)

export const MainWindowNavigationProvider = MainWindowNavigationContext.Provider

export function useMainWindowNavigation(): MainWindowNavigationActions {
  const context = useContext(MainWindowNavigationContext)
  const activeId = useReposStore((s) => s.activeId)
  const order = useReposStore((s) => s.order)
  const setActive = useReposStore((s) => s.setActive)
  const closeRepo = useReposStore((s) => s.closeRepo)
  const cycleActive = useReposStore((s) => s.cycleActive)
  const selectBranch = useReposStore((s) => s.selectBranch)
  const setDetailTab = useReposStore((s) => s.setDetailTab)
  const fallbackNavigation = useMemo(
    () =>
      createMainWindowNavigationActions({
        activeId,
        order,
        setActive,
        closeRepo,
        cycleActive,
        selectBranch,
        setDetailTab,
      }),
    [activeId, closeRepo, cycleActive, order, selectBranch, setActive, setDetailTab],
  )

  return context ?? fallbackNavigation
}
