import { createContext, useContext, useMemo } from 'react'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useReposStore } from '#/web/stores/repos/store.ts'
import {
  createMainWindowNavigationActions,
  type MainWindowNavigationActions,
} from '#/web/main-window-navigation-actions.ts'
import {
  mainWindowNavigationStoreActionsEqual,
  mainWindowNavigationStoreActionsFromStore,
} from '#/web/stores/repos/selector-actions.ts'
import { navigationWorkspaceStateEqual, navigationWorkspaceStateFromStore } from '#/web/stores/repos/selector-state.ts'
export type { MainWindowNavigationActions } from '#/web/main-window-navigation-actions.ts'

const MainWindowNavigationContext = createContext<MainWindowNavigationActions | null>(null)

export const MainWindowNavigationProvider = MainWindowNavigationContext.Provider

export function useMainWindowNavigation(): MainWindowNavigationActions {
  const context = useContext(MainWindowNavigationContext)
  const { activeId, order } = useStoreWithEqualityFn(
    useReposStore,
    navigationWorkspaceStateFromStore,
    navigationWorkspaceStateEqual,
  )
  const { setActive, closeRepo, cycleActive, selectBranch, setDetailTab } = useStoreWithEqualityFn(
    useReposStore,
    mainWindowNavigationStoreActionsFromStore,
    mainWindowNavigationStoreActionsEqual,
  )
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
