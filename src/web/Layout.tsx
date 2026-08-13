import { computed, defineComponent } from 'vue'
import type { ComputedRef, PropType, VNode } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import { useQueryClient } from '@tanstack/vue-query'
import { useRepoSnapshotReadModel } from '#/web/repo-queries.ts'
import { ErrorBoundary } from '#/web/components/ErrorBoundary.tsx'
import { TerminalSessionProvider } from '#/web/components/terminal/TerminalSessionProvider.tsx'
import { AppRuntimeProjectionProvider } from '#/web/runtime/AppRuntimeProjectionProvider.tsx'
import { TokenGate } from '#/web/components/TokenGate.tsx'
import { useAuthenticatedAppBootstrap } from '#/web/hooks/useAuthenticatedAppBootstrap.ts'
import { useAppOverlays } from '#/web/hooks/useAppOverlays.ts'
import { useWorkspaceDrop } from '#/web/hooks/useWorkspaceDrop.ts'
import { useWorkspaceFilesystemInvalidationSync } from '#/web/hooks/useWorkspaceFilesystemInvalidationSync.ts'
import { useClientWorkspacePersistence } from '#/web/hooks/useClientWorkspacePersistence.ts'
import { createAppNavigationActions } from '#/web/app-navigation-actions.ts'
import { AppNavigationProvider } from '#/web/app-navigation.tsx'
import { provideLayoutOverlayActions } from '#/web/layout-overlay-actions-context.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { appNavigationStoreActionsFromStore } from '#/web/stores/workspaces/selector-actions.ts'
import { workspaceIdFromSlug } from '#/web/workspace-route-slugs.ts'
import { useAppRouteNavigation } from '#/web/app-route-navigation.ts'
import { useAppHistoryPresentationObserver } from '#/web/app-history-presentation.ts'
import { workspacePaneCommandTargetFromQueryCache } from '#/web/workspace-pane/workspace-pane-command-target.ts'
import {
  appLayoutRouteCallbacks,
  currentWorkspacePaneRouteFromContext,
  workspaceNavigationRouteContext,
  workspaceRouteContextFromVueRoute,
} from '#/web/app-layout-model.ts'
import {
  WorkspaceSessionRestoreError,
  WorkspaceSessionRestorePlaceholder,
} from '#/web/components/WorkspaceSessionRestore.tsx'
import { AppGlobalOverlays, WorkspaceContextOverlays } from '#/web/components/AppOverlays.tsx'
import { AuthenticatedWorkspaceSideEffects } from '#/web/components/AuthenticatedWorkspaceSideEffects.tsx'
import { useStoreSelector } from '#/web/stores/store-selector.ts'
import { useClientEffectIntentRouter } from '#/web/hooks/useClientEffectIntentRouter.ts'
import type { AppNavigationActions } from '#/web/app-navigation-actions.ts'
import type { WorkspacePaneCommandTarget } from '#/web/workspace-pane/workspace-pane-command-target.ts'
import type { WorkspaceNavigationRouteContext } from '#/web/workspace-navigation-history.ts'
import { canonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { GitWorkspaceNavigatorRowIdentity } from '#/web/components/workspace-navigator/git-workspace-navigator-model.ts'

const INACTIVE_REPO_QUERY_WORKSPACE_ID = requiredWorkspaceId('goblin+file:///inactive-repo-query')

type AppOverlayController = ReturnType<typeof useAppOverlays>

interface AuthenticatedAppRuntime {
  hydratedRouteWorkspaceId: ComputedRef<WorkspaceId | null>
  currentBranchName: ComputedRef<string | null>
  currentGitWorkspaceNavigatorRowIdentity: ComputedRef<GitWorkspaceNavigatorRowIdentity | null>
  currentWorkspacePaneRoute: ComputedRef<ReturnType<typeof currentWorkspacePaneRouteFromContext>>
  currentWorkspacePaneCommandTarget: () => WorkspacePaneCommandTarget | null
  workspaceNavigationRouteContext: ComputedRef<WorkspaceNavigationRouteContext | null>
  navigation: ComputedRef<AppNavigationActions>
  commandWorkspaceRuntimeId: ComputedRef<string | null>
  overlays: AppOverlayController
  navigateToSettingsShortcuts: () => void
  navigateToIndex: () => void
}

export const Layout = defineComponent({
  name: 'Layout',
  setup() {
    const route = useRoute()
    useAppHistoryPresentationObserver()

    return () => (
      <ErrorBoundary resetKey={route.fullPath}>
        <TokenGate>
          <AuthenticatedAppShell />
        </TokenGate>
      </ErrorBoundary>
    )
  },
})

const AuthenticatedAppShell = defineComponent({
  name: 'AuthenticatedAppShell',
  setup() {
    useWorkspaceFilesystemInvalidationSync()
    const route = useRoute()
    const queryClient = useQueryClient()
    const overlays = useAppOverlays()
    const workspaces = useStoreSelector(workspacesStore, (state) => state.workspaces)
    const workspaceOrder = useStoreSelector(workspacesStore, (state) => state.workspaceOrder)
    const routeContext = computed(() => workspaceRouteContextFromVueRoute(route))
    const routedWorkspaceId = computed(() => {
      const workspaceSlug = routeContext.value?.workspaceSlug
      return workspaceSlug ? workspaceIdFromSlug(workspaceSlug) : null
    })
    const hydratedRouteWorkspaceId = computed(() => {
      const workspaceId = routedWorkspaceId.value
      return workspaceId ? (workspaces.value[workspaceId]?.id ?? null) : null
    })
    const commandWorkspace = computed(() => {
      const workspaceId = hydratedRouteWorkspaceId.value
      return workspaceId ? workspaces.value[workspaceId] : undefined
    })
    const currentRepoSnapshot = useRepoSnapshotReadModel(
      () => commandWorkspace.value?.id ?? INACTIVE_REPO_QUERY_WORKSPACE_ID,
      () => commandWorkspace.value?.workspaceRuntimeId ?? '',
      { enabled: computed(() => commandWorkspace.value?.capability.kind === 'git') },
    )
    const currentBranchName = computed(() => {
      const context = routeContext.value
      if (context?.kind === 'branch') return context.branchName
      if (context?.kind !== 'worktree') return null
      const worktree = currentRepoSnapshot.data.value?.snapshot.worktrees.find(
        (candidate) => candidate.path === context.worktreePath,
      )
      return worktree?.head.kind === 'branch' ? worktree.head.branchName : null
    })
    const currentGitWorkspaceNavigatorRowIdentity = computed<GitWorkspaceNavigatorRowIdentity | null>(() => {
      const context = routeContext.value
      if (context?.kind === 'branch') return { kind: 'branch', branchName: context.branchName }
      if (context?.kind === 'worktree') return { kind: 'worktree', worktreePath: context.worktreePath }
      return null
    })
    const currentWorkspacePaneRoute = computed(() => currentWorkspacePaneRouteFromContext(routeContext.value))
    const { closeWorkspace, peekWorkspaceNavigation, commitWorkspaceNavigation } = appNavigationStoreActionsFromStore(
      workspacesStore.getState(),
    )
    const routeNavigation = useAppRouteNavigation()
    const layoutRouteCallbacks = appLayoutRouteCallbacks(routeNavigation)
    const navigation = computed(() =>
      createAppNavigationActions({
        currentWorkspaceId: hydratedRouteWorkspaceId.value,
        workspaceOrder: workspaceOrder.value,
        closeWorkspace,
        peekWorkspaceNavigation,
        commitWorkspaceNavigation,
        routeNavigation,
      }),
    )
    const currentWorkspacePaneCommandTarget = () =>
      workspacePaneCommandTargetFromQueryCache({
        routeContext: routeContext.value,
        workspace: commandWorkspace.value,
        queryClient,
      })
    const runtime: AuthenticatedAppRuntime = {
      hydratedRouteWorkspaceId,
      currentBranchName,
      currentGitWorkspaceNavigatorRowIdentity,
      currentWorkspacePaneRoute,
      currentWorkspacePaneCommandTarget,
      workspaceNavigationRouteContext: computed(() =>
        workspaceNavigationRouteContext(routeContext.value, route.fullPath),
      ),
      navigation,
      commandWorkspaceRuntimeId: computed(() => commandWorkspace.value?.workspaceRuntimeId ?? null),
      overlays,
      navigateToSettingsShortcuts: layoutRouteCallbacks.navigateToSettingsShortcuts,
      navigateToIndex: layoutRouteCallbacks.navigateToIndex,
    }
    const bootstrap = useAuthenticatedAppBootstrap({ activeWorkspaceId: routedWorkspaceId })
    useClientWorkspacePersistence({ routedWorkspaceId })

    provideLayoutOverlayActions({
      openWorkspacePathDialog: overlays.openWorkspacePathDialog,
      openCloneRepo: overlays.openCloneRepo,
      openRemoteWorkspace: overlays.openRemoteWorkspace,
      openCreateWorktree: () => navigation.value.openCreateWorktree(),
    })

    useClientEffectIntentRouter({
      authenticatedBootstrapState: bootstrap.state,
      navigation,
      currentWorkspaceId: hydratedRouteWorkspaceId,
      currentWorkspacePaneCommandTarget,
      closeAllOverlays: overlays.closeAllOverlays,
      openWorkspacePathDialog: overlays.openWorkspacePathDialog,
      openCloneRepo: overlays.openCloneRepo,
      openRemoteWorkspace: overlays.openRemoteWorkspace,
      openCreateWorktree: () => navigation.value.openCreateWorktree(),
      isOverlayOpen: () => overlays.anyOpen.value,
      isWorkspaceShortcutSuppressed: () => overlays.anyOpen.value,
    })

    const renderShellContent = (): VNode => {
      if (route.name === 'settings') return <AuthenticatedSettingsShell />

      const bootstrapState = bootstrap.state.value

      switch (bootstrapState.status) {
        case 'restoring-workspace':
          return <WorkspaceSessionRestorePlaceholder />
        case 'failed':
          return <WorkspaceSessionRestoreError state={bootstrapState} retry={bootstrap.retry} />
        case 'ready':
          return <AuthenticatedWorkspaceShell runtime={runtime} />
      }
    }

    return () => (
      <TerminalSessionProvider>
        <AppNavigationProvider value={navigation.value}>
          {renderShellContent()}
          <AppGlobalOverlays overlays={overlays} />
        </AppNavigationProvider>
      </TerminalSessionProvider>
    )
  },
})

function requiredWorkspaceId(value: string): WorkspaceId {
  const workspaceId = canonicalWorkspaceLocator(value)
  if (!workspaceId) throw new Error(`Invalid internal workspace locator: ${value}`)
  return workspaceId
}

const AuthenticatedSettingsShell = defineComponent({
  name: 'AuthenticatedSettingsShell',
  setup() {
    return () => (
      <div class="relative flex h-full flex-col">
        <RouterView />
      </div>
    )
  },
})

const AuthenticatedWorkspaceShell = defineComponent<{ runtime: AuthenticatedAppRuntime }>({
  name: 'AuthenticatedWorkspaceShell',
  inheritAttrs: false,
  props: {
    runtime: { type: Object as PropType<AuthenticatedAppRuntime>, required: true },
  },
  setup(props) {
    const runtime = props.runtime
    const overlays = runtime.overlays
    const workspaceDrop = useWorkspaceDrop({
      blocked: overlays.anyOpen,
      navigation: runtime.navigation,
    })

    return () => {
      const currentNavigation = runtime.navigation.value
      return (
        <>
          <AuthenticatedWorkspaceSideEffects
            hydratedRouteWorkspaceId={runtime.hydratedRouteWorkspaceId.value}
            currentBranchName={runtime.currentBranchName.value}
            currentGitWorkspaceNavigatorRowIdentity={runtime.currentGitWorkspaceNavigatorRowIdentity.value}
            currentWorkspacePaneCommandTarget={runtime.currentWorkspacePaneCommandTarget}
            routeContext={runtime.workspaceNavigationRouteContext.value}
            navigation={currentNavigation}
            modalOpen={overlays.anyOpen.value}
            navigateToSettingsShortcuts={runtime.navigateToSettingsShortcuts}
            navigateToIndex={runtime.navigateToIndex}
          />
          <AppRuntimeProjectionProvider currentWorkspaceId={runtime.hydratedRouteWorkspaceId.value}>
            <div
              class="relative flex h-full flex-col"
              onDragenter={workspaceDrop.onDragEnter}
              onDragover={workspaceDrop.onDragOver}
              onDragleave={workspaceDrop.onDragLeave}
              onDrop={workspaceDrop.onDrop}
            >
              <RouterView />
              <WorkspaceContextOverlays
                workspaceDrop={workspaceDrop}
                navigation={currentNavigation}
                hydratedRouteWorkspaceId={runtime.hydratedRouteWorkspaceId.value}
                currentWorkspaceRuntimeId={runtime.commandWorkspaceRuntimeId.value}
                currentBranchName={runtime.currentBranchName.value}
                currentWorkspacePaneRoute={runtime.currentWorkspacePaneRoute.value}
              />
            </div>
          </AppRuntimeProjectionProvider>
        </>
      )
    }
  },
})
