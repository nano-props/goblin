import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { createAppNavigationActions, type AppNavigationActions } from '#/web/app-navigation-actions.ts'
import { appNavigationStoreActionsFromStore } from '#/web/stores/workspaces/selector-actions.ts'
import { useAppRouteNavigation } from '#/web/app-route-navigation.ts'
export type { AppNavigationActions } from '#/web/app-navigation-actions.ts'

const AppNavigationContext = createContext<AppNavigationActions | null>(null)

export function AppNavigationProvider({
  value,
  children,
}: {
  value: AppNavigationActions | null
  children: ReactNode
}) {
  return <AppNavigationContext value={value}>{children}</AppNavigationContext>
}

export function useAppNavigation(): AppNavigationActions {
  const context = useContext(AppNavigationContext)
  if (context) return context

  const workspaceOrder = useWorkspacesStore((s) => s.workspaceOrder)
  const { closeWorkspace, peekWorkspaceNavigation, commitWorkspaceNavigation } = useWorkspacesStore(
    useShallow(appNavigationStoreActionsFromStore),
  )
  const routeNavigation = useAppRouteNavigation()
  const fallbackNavigation = useMemo(
    () =>
      createAppNavigationActions({
        currentWorkspaceId: null,
        workspaceOrder,
        closeWorkspace,
        peekWorkspaceNavigation,
        commitWorkspaceNavigation,
        routeNavigation,
      }),
    [closeWorkspace, peekWorkspaceNavigation, commitWorkspaceNavigation, workspaceOrder, routeNavigation],
  )

  return fallbackNavigation
}
