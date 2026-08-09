import { computed, defineComponent } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import { useQueryClient } from '@tanstack/vue-query'
import { ErrorBoundary } from '#/web/components/ErrorBoundary.tsx'
import { TerminalSessionProvider } from '#/web/components/terminal/TerminalSessionProvider.tsx'
import { AppRuntimeProjectionProvider } from '#/web/runtime/AppRuntimeProjectionProvider.tsx'
import { TokenGate } from '#/web/components/TokenGate.tsx'
import { Toaster } from '#/web/components/ui/sonner.tsx'
import { useAuthenticatedAppBootstrap } from '#/web/hooks/useAuthenticatedAppBootstrap.ts'
import { useAppOverlays } from '#/web/hooks/useAppOverlays.ts'
import { useWorkspaceDrop } from '#/web/hooks/useWorkspaceDrop.ts'
import { useWorkspaceFilesystemInvalidationSync } from '#/web/hooks/useWorkspaceFilesystemInvalidationSync.ts'
import { useSettingsWriteErrorToast } from '#/web/hooks/useSettingsWriteErrorToast.ts'
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
  authenticatedAppShellMode,
  currentWorkspacePaneRouteFromContext,
  workspaceNavigationRouteContext,
  workspaceRouteContextFromVueRoute,
} from '#/web/app-layout-model.ts'
import {
  WorkspaceSessionRestoreError,
  WorkspaceSessionRestorePlaceholder,
} from '#/web/components/WorkspaceSessionRestore.tsx'
import { AppOverlays } from '#/web/components/AppOverlays.tsx'
import { AuthenticatedWorkspaceSideEffects } from '#/web/components/AuthenticatedWorkspaceSideEffects.tsx'
import { useStoreSelector } from '#/web/stores/store-selector.ts'

export const Layout = defineComponent({
  name: 'Layout',
  setup() {
    const route = useRoute()
    useSettingsWriteErrorToast()
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
    const routeContext = computed(() => workspaceRouteContextFromVueRoute(route))
    const activeWorkspaceId = computed(() => {
      const workspaceSlug = routeContext.value?.workspaceSlug
      return workspaceSlug ? workspaceIdFromSlug(workspaceSlug) : null
    })
    const bootstrap = useAuthenticatedAppBootstrap({ activeWorkspaceId })

    return () => {
      const bootstrapState = bootstrap.state.value
      const shellMode = authenticatedAppShellMode(route.path, bootstrapState)
      return (
        <TerminalSessionProvider>
          {shellMode === 'settings' ? (
            <AuthenticatedSettingsShell />
          ) : shellMode === 'workspace-restore' ? (
            <WorkspaceSessionRestorePlaceholder />
          ) : shellMode === 'workspace-failed' && bootstrapState.status === 'failed' ? (
            <WorkspaceSessionRestoreError state={bootstrapState} retry={bootstrap.retry} />
          ) : (
            <AuthenticatedWorkspaceShell />
          )}
        </TerminalSessionProvider>
      )
    }
  },
})

const AuthenticatedSettingsShell = defineComponent({
  name: 'AuthenticatedSettingsShell',
  setup() {
    return () => (
      <div class="relative flex h-full flex-col">
        <RouterView />
        <Toaster position="bottom-right" closeButton />
      </div>
    )
  },
})

const AuthenticatedWorkspaceShell = defineComponent({
  name: 'AuthenticatedWorkspaceShell',
  inheritAttrs: false,
  setup() {
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
    const currentBranchName = computed(() => {
      const context = routeContext.value
      return context?.kind === 'branch' ? context.branchName : null
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
    const workspaceDrop = useWorkspaceDrop({
      blocked: overlays.anyOpen,
      navigation,
    })

    provideLayoutOverlayActions({
      openWorkspacePathDialog: overlays.openWorkspacePathDialog,
      openCloneRepo: overlays.openCloneRepo,
      openRemoteWorkspace: overlays.openRemoteWorkspace,
      openCreateWorktree: () => navigation.value.openCreateWorktree(),
    })

    const currentWorkspacePaneCommandTarget = () =>
      workspacePaneCommandTargetFromQueryCache({
        routeContext: routeContext.value,
        workspace: commandWorkspace.value,
        queryClient,
      })

    return () => {
      const currentRouteContext = routeContext.value
      const currentNavigation = navigation.value
      return (
        <>
          <AuthenticatedWorkspaceSideEffects
            routedWorkspaceId={routedWorkspaceId.value}
            hydratedRouteWorkspaceId={hydratedRouteWorkspaceId.value}
            currentBranchName={currentBranchName.value}
            currentWorkspacePaneCommandTarget={currentWorkspacePaneCommandTarget}
            routeContext={workspaceNavigationRouteContext(currentRouteContext, route.fullPath)}
            navigation={currentNavigation}
            closeAllOverlays={overlays.closeAllOverlays}
            openWorkspacePathDialog={overlays.openWorkspacePathDialog}
            openCloneRepo={overlays.openCloneRepo}
            openRemoteWorkspace={overlays.openRemoteWorkspace}
            modalOpen={overlays.anyOpen.value}
            navigateToSettingsShortcuts={layoutRouteCallbacks.navigateToSettingsShortcuts}
            navigateToIndex={layoutRouteCallbacks.navigateToIndex}
          />
          <AppNavigationProvider value={currentNavigation}>
            <AppRuntimeProjectionProvider currentWorkspaceId={hydratedRouteWorkspaceId.value}>
              <div
                class="relative flex h-full flex-col"
                onDragenter={workspaceDrop.onDragEnter}
                onDragover={workspaceDrop.onDragOver}
                onDragleave={workspaceDrop.onDragLeave}
                onDrop={workspaceDrop.onDrop}
              >
                <RouterView />
                <AppOverlays
                  overlays={overlays}
                  workspaceDrop={workspaceDrop}
                  navigation={currentNavigation}
                  hydratedRouteWorkspaceId={hydratedRouteWorkspaceId.value}
                  currentWorkspaceRuntimeId={commandWorkspace.value?.workspaceRuntimeId ?? null}
                  currentBranchName={currentBranchName.value}
                  currentWorkspacePaneRoute={currentWorkspacePaneRoute.value}
                />
              </div>
            </AppRuntimeProjectionProvider>
          </AppNavigationProvider>
        </>
      )
    }
  },
})
