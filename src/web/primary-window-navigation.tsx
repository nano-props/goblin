import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useReposStore } from '#/web/stores/repos/store.ts'
import {
  createPrimaryWindowNavigationActions,
  type PrimaryWindowNavigationActions,
} from '#/web/primary-window-navigation-actions.ts'
import { primaryWindowNavigationStoreActionsFromStore } from '#/web/stores/repos/selector-actions.ts'
import { usePrimaryWindowRouteNavigation } from '#/web/primary-window-route-navigation.ts'
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
  if (context) return context

  const order = useReposStore((s) => s.order)
  const { closeRepo, goBackInWorkspaceNavigation, goForwardInWorkspaceNavigation } = useReposStore(
    useShallow(primaryWindowNavigationStoreActionsFromStore),
  )
  const routeNavigation = usePrimaryWindowRouteNavigation()
  const fallbackNavigation = useMemo(
    () =>
      createPrimaryWindowNavigationActions({
        currentRepoId: null,
        order,
        closeRepo,
        goBackInWorkspaceNavigation,
        goForwardInWorkspaceNavigation,
        routeNavigation,
      }),
    [
      closeRepo,
      goBackInWorkspaceNavigation,
      goForwardInWorkspaceNavigation,
      order,
      routeNavigation,
    ],
  )

  return fallbackNavigation
}
