import { computed, defineComponent } from 'vue'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { AppNavigationActions } from '#/web/app-navigation-actions.ts'
import { useBackgroundFetch } from '#/web/hooks/useBackgroundFetch.ts'
import { useClientEffectIntentRouter } from '#/web/hooks/useClientEffectIntentRouter.ts'
import { useClientWorkspacePersistence } from '#/web/hooks/useClientWorkspacePersistence.ts'
import { useKeyboard } from '#/web/hooks/useKeyboard.ts'
import { useRepoStoreInvalidationRefresh } from '#/web/hooks/useRepoStoreInvalidationRefresh.ts'
import { useWorkspaceRuntimeInvalidationRefresh } from '#/web/hooks/useWorkspaceRuntimeInvalidationRefresh.ts'
import { useSettingsQueryInvalidationSync } from '#/web/settings-queries.ts'
import type { WorkspaceNavigationRouteContext } from '#/web/workspace-navigation-history.ts'
import { useWorkspaceNavigationHistory } from '#/web/workspace-navigation-history.ts'
import type { WorkspacePaneCommandTarget } from '#/web/workspace-pane/workspace-pane-command-target.ts'
import { useTerminalRetirementWorkspacePanePresentation } from '#/web/workspace-pane/use-terminal-retirement-workspace-pane-presentation.ts'
import { hasClientServerConfig } from '#/web/lib/server-config.ts'
import { useStoreSelector } from '#/web/stores/store-selector.ts'
import { workspaceCanExecute } from '#/web/stores/workspaces/workspace-guards.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'

interface AuthenticatedWorkspaceSideEffectsProps {
  routedWorkspaceId: WorkspaceId | null
  hydratedRouteWorkspaceId: WorkspaceId | null
  currentBranchName: string | null
  currentWorkspacePaneCommandTarget: () => WorkspacePaneCommandTarget | null
  routeContext: WorkspaceNavigationRouteContext | null
  navigation: AppNavigationActions
  closeAllOverlays: () => void
  openWorkspacePathDialog: () => void
  openCloneRepo: () => void
  openRemoteWorkspace: () => void
  modalOpen: boolean
  navigateToSettingsShortcuts: () => void
  navigateToIndex: () => void
}

/**
 * Stable auth-gated owner for application subscriptions, command routing, and
 * keyboard handling. Route changes update its inputs without restarting those
 * lifetimes; command targets are resolved from authoritative state at the event boundary.
 */
export const AuthenticatedWorkspaceSideEffects = defineComponent<AuthenticatedWorkspaceSideEffectsProps>({
  name: 'AuthenticatedWorkspaceSideEffects',
  inheritAttrs: false,
  props: [
    'routedWorkspaceId',
    'hydratedRouteWorkspaceId',
    'currentBranchName',
    'currentWorkspacePaneCommandTarget',
    'routeContext',
    'navigation',
    'closeAllOverlays',
    'openWorkspacePathDialog',
    'openCloneRepo',
    'openRemoteWorkspace',
    'modalOpen',
    'navigateToSettingsShortcuts',
    'navigateToIndex',
  ],
  setup(props) {
    const workspaceShortcutsSuppressed = () => props.modalOpen
    const currentWorkspacePaneCommandTarget = () => props.currentWorkspacePaneCommandTarget()

    useTerminalRetirementWorkspacePanePresentation({
      currentTarget: currentWorkspacePaneCommandTarget,
      navigation: () => props.navigation,
    })
    useClientEffectIntentRouter({
      navigation: () => props.navigation,
      currentWorkspaceId: () => props.hydratedRouteWorkspaceId,
      currentWorkspacePaneCommandTarget,
      closeAllOverlays: () => props.closeAllOverlays(),
      openWorkspacePathDialog: () => props.openWorkspacePathDialog(),
      openCloneRepo: () => props.openCloneRepo(),
      openRemoteWorkspace: () => props.openRemoteWorkspace(),
      openCreateWorktree: () => props.navigation.openCreateWorktree(),
      isOverlayOpen: () => props.modalOpen,
      isWorkspaceShortcutSuppressed: workspaceShortcutsSuppressed,
    })
    useKeyboard({
      navigation: () => props.navigation,
      currentWorkspaceId: () => props.hydratedRouteWorkspaceId,
      currentBranchName: () => props.currentBranchName,
      currentWorkspacePaneCommandTarget,
      onShowHelp: () => props.navigateToSettingsShortcuts(),
      isWorkspaceShortcutSuppressed: workspaceShortcutsSuppressed,
      isSettingsOpen: () => false,
      onExitSettings: () => props.navigateToIndex(),
      openCreateWorktree: () => props.navigation.openCreateWorktree(),
    })
    useClientWorkspacePersistence({ routedWorkspaceId: () => props.routedWorkspaceId })
    useWorkspaceNavigationHistory({ routeContext: () => props.routeContext })
    useRepoStoreInvalidationRefresh()
    useWorkspaceRuntimeInvalidationRefresh()
    useSettingsQueryInvalidationSync()

    const workspaces = useStoreSelector(workspacesStore, (state) => state.workspaces)
    const backgroundFetchTarget = computed(() => {
      const workspaceId = props.hydratedRouteWorkspaceId
      const workspace = workspaceId ? workspaces.value[workspaceId] : undefined
      return workspace && workspaceCanExecute(workspace) && workspace.capability.kind === 'git'
        ? { workspaceId: workspace.id, workspaceRuntimeId: workspace.workspaceRuntimeId }
        : null
    })
    const backgroundFetchAvailable = hasClientServerConfig()

    return () => {
      const target = backgroundFetchTarget.value
      return backgroundFetchAvailable && target ? (
        <BackgroundFetchOwner workspaceId={target.workspaceId} workspaceRuntimeId={target.workspaceRuntimeId} />
      ) : null
    }
  },
})

interface BackgroundFetchOwnerProps {
  workspaceId: WorkspaceId
  workspaceRuntimeId: string
}

const BackgroundFetchOwner = defineComponent<BackgroundFetchOwnerProps>({
  name: 'BackgroundFetchOwner',
  inheritAttrs: false,
  props: ['workspaceId', 'workspaceRuntimeId'],
  setup(props) {
    useBackgroundFetch({
      workspaceId: () => props.workspaceId,
      workspaceRuntimeId: () => props.workspaceRuntimeId,
    })
    return () => null
  },
})
