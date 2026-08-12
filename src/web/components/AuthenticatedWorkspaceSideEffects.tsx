import { computed, defineComponent } from 'vue'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { AppNavigationActions } from '#/web/app-navigation-actions.ts'
import { useBackgroundFetch } from '#/web/hooks/useBackgroundFetch.ts'
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
  hydratedRouteWorkspaceId: WorkspaceId | null
  currentBranchName: string | null
  currentWorkspacePaneCommandTarget: () => WorkspacePaneCommandTarget | null
  routeContext: WorkspaceNavigationRouteContext | null
  navigation: AppNavigationActions
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
    'hydratedRouteWorkspaceId',
    'currentBranchName',
    'currentWorkspacePaneCommandTarget',
    'routeContext',
    'navigation',
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
