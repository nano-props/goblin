import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { AppNavigationActions } from '#/web/app-navigation.tsx'
import { useBackgroundFetch } from '#/web/hooks/useBackgroundFetch.ts'
import { useClientEffectIntentRouter } from '#/web/hooks/useClientEffectIntentRouter.ts'
import { useClientWorkspacePersistence } from '#/web/hooks/useClientWorkspacePersistence.ts'
import { useKeyboard } from '#/web/hooks/useKeyboard.ts'
import { useNetworkReconnect } from '#/web/hooks/useNetworkReconnect.ts'
import { useRepoStoreInvalidationRefresh } from '#/web/hooks/useRepoStoreInvalidationRefresh.ts'
import { useWorkspaceRuntimeInvalidationRefresh } from '#/web/hooks/useWorkspaceRuntimeInvalidationRefresh.ts'
import { useSettingsQueryInvalidationSync } from '#/web/settings-queries.ts'
import type { WorkspaceNavigationRouteContext } from '#/web/workspace-navigation-history.ts'
import { useWorkspaceNavigationHistory } from '#/web/workspace-navigation-history.ts'
import type { WorkspacePaneCommandTarget } from '#/web/workspace-pane/workspace-pane-command-target.ts'
import { useTerminalRetirementWorkspacePanePresentation } from '#/web/workspace-pane/use-terminal-retirement-workspace-pane-presentation.ts'

/**
 * Auth-gated side effects. Mounts only when `<TokenGate>` lets
 * its children through (i.e. the user is authenticated), so the
 * hooks below — and the WebSocket connections they open — do
 * not exist while the login form is showing.
 *
 * This is the architectural fix for the "/ws/invalidation
 * 401-flood on first load" bug. The pre-fix Layout declared the
 * invalidation hooks at its top level, so they ran before
 * `TokenGate` had a chance to decide whether the user was
 * authenticated. The result was an unauthenticated WebSocket
 * upgrade every 300 ms (the client's reconnect delay) until the
 * user logged in.
 *
 * Rules of hooks: this component exists solely to host hooks.
 * It renders `null` because no other subtree needs the same set
 * of subscriptions.
 */
export function AuthenticatedWorkspaceSideEffects({
  routedWorkspaceId,
  hydratedRouteWorkspaceId,
  currentBranchName,
  currentWorkspacePaneCommandTarget,
  routeContext,
  navigation,
  closeAllOverlays,
  openWorkspacePathDialog,
  openCloneRepo,
  openRemoteWorkspace,
  modalOpen,
  navigateToSettingsShortcuts,
  navigateToIndex,
}: {
  routedWorkspaceId: WorkspaceId | null
  hydratedRouteWorkspaceId: WorkspaceId | null
  currentBranchName: string | null
  currentWorkspacePaneCommandTarget: WorkspacePaneCommandTarget | null
  routeContext: WorkspaceNavigationRouteContext | null
  navigation: AppNavigationActions
  closeAllOverlays: () => void
  openWorkspacePathDialog: () => void
  openCloneRepo: () => void
  openRemoteWorkspace: () => void
  modalOpen: boolean
  navigateToSettingsShortcuts: () => void
  navigateToIndex: () => void
}): null {
  const workspaceShortcutsSuppressed = modalOpen
  useTerminalRetirementWorkspacePanePresentation({
    currentTarget: currentWorkspacePaneCommandTarget,
    navigation,
  })
  useClientEffectIntentRouter({
    navigation,
    currentWorkspaceId: hydratedRouteWorkspaceId,
    currentWorkspacePaneCommandTarget,
    closeAllOverlays,
    openWorkspacePathDialog,
    openCloneRepo,
    openRemoteWorkspace,
    openCreateWorktree: navigation.openCreateWorktree,
    isOverlayOpen: () => modalOpen,
    isWorkspaceShortcutSuppressed: () => workspaceShortcutsSuppressed,
  })

  useKeyboard({
    navigation,
    currentWorkspaceId: hydratedRouteWorkspaceId,
    currentBranchName,
    currentWorkspacePaneCommandTarget,
    onShowHelp: navigateToSettingsShortcuts,
    isWorkspaceShortcutSuppressed: () => workspaceShortcutsSuppressed,
    isSettingsOpen: () => false,
    onExitSettings: navigateToIndex,
    openCreateWorktree: navigation.openCreateWorktree,
  })

  useClientWorkspacePersistence({ routedWorkspaceId })
  useWorkspaceNavigationHistory({ routeContext })
  useBackgroundFetch({ currentWorkspaceId: hydratedRouteWorkspaceId })
  useNetworkReconnect()
  useRepoStoreInvalidationRefresh()
  useWorkspaceRuntimeInvalidationRefresh()
  useSettingsQueryInvalidationSync()
  return null
}
