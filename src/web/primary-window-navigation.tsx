import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import {
  createPrimaryWindowNavigationActions,
  type PrimaryWindowNavigationActions,
} from '#/web/primary-window-navigation-actions.ts'
import { primaryWindowNavigationStoreActionsFromStore } from '#/web/stores/workspaces/selector-actions.ts'
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

  const workspaceOrder = useWorkspacesStore((s) => s.workspaceOrder)
  const { closeWorkspace, peekWorkspaceNavigation, commitWorkspaceNavigation } = useWorkspacesStore(
    useShallow(primaryWindowNavigationStoreActionsFromStore),
  )
  const routeNavigation = usePrimaryWindowRouteNavigation()
  const fallbackNavigation = useMemo(
    () =>
      createPrimaryWindowNavigationActions({
        currentWorkspaceId: null,
        workspaceOrder,
        closeWorkspace,
        peekWorkspaceNavigation,
        commitWorkspaceNavigation,
        routeNavigation,
      }),
    [
      closeWorkspace,
      peekWorkspaceNavigation,
      commitWorkspaceNavigation,
      workspaceOrder,
      routeNavigation,
    ],
  )

  return fallbackNavigation
}
