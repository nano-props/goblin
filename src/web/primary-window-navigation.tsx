import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useReposStore } from '#/web/stores/repos/store.ts'
import {
  createPrimaryWindowNavigationActions,
  type PrimaryWindowNavigationActions,
} from '#/web/primary-window-navigation-actions.ts'
import { primaryWindowNavigationStoreActionsFromStore } from '#/web/stores/repos/selector-actions.ts'
import { navigationWorkspaceStateEqual, navigationWorkspaceStateFromStore } from '#/web/stores/repos/selector-state.ts'
export type { PrimaryWindowNavigationActions } from '#/web/primary-window-navigation-actions.ts'

const PrimaryWindowNavigationContext = createContext<PrimaryWindowNavigationActions | null>(null)

export function PrimaryWindowNavigationProvider({
  value,
  children,
}: {
  value: PrimaryWindowNavigationActions | null
  children: ReactNode
}) {
  return <PrimaryWindowNavigationContext value={value}>{children}</PrimaryWindowNavigationContext>
}

export function usePrimaryWindowNavigation(): PrimaryWindowNavigationActions {
  const context = useContext(PrimaryWindowNavigationContext)
  const { activeId, order } = useStoreWithEqualityFn(
    useReposStore,
    navigationWorkspaceStateFromStore,
    navigationWorkspaceStateEqual,
  )
  const { setActive, closeRepo, cycleActive, selectBranch, setWorkspacePaneTab } = useReposStore(
    useShallow(primaryWindowNavigationStoreActionsFromStore),
  )
  const fallbackNavigation = useMemo(
    () =>
      createPrimaryWindowNavigationActions({
        activeId,
        order,
        setActive,
        closeRepo,
        cycleActive,
        selectBranch,
        setWorkspacePaneTab,
      }),
    [activeId, closeRepo, cycleActive, order, selectBranch, setActive, setWorkspacePaneTab],
  )

  return context ?? fallbackNavigation
}
