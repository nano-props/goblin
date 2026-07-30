import { useMemo } from 'react'
import { Outlet, useRouterState } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
import { useShallow } from 'zustand/react/shallow'
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
import { LayoutOverlayActions } from '#/web/layout-overlay-actions-context.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { appNavigationStoreActionsFromStore } from '#/web/stores/workspaces/selector-actions.ts'
import { workspaceIdFromSlug } from '#/web/workspace-route-slugs.ts'
import { useAppRouteActions } from '#/web/app-route-navigation.ts'
import { useAppHistoryPresentationObserver } from '#/web/workspace-navigation-history.ts'
import type { WorkspacePaneCommandTarget } from '#/web/workspace-pane/workspace-pane-command-target.ts'
import { useRepoSnapshotReadModel, useRepoWorktreeStatusReadModel } from '#/web/repo-queries.ts'
import {
  gitWorktreePaneFilesystemTarget,
  workspaceRootPaneFilesystemTarget,
} from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'
import { gitHead } from '#/shared/git-head.ts'
import {
  appLayoutRouteCallbacks,
  authenticatedAppShellMode,
  currentWorkspacePaneRouteFromContext,
  workspaceNavigationRouteContext,
  workspaceRouteContextFromMatches,
} from '#/web/app-layout-model.ts'
import {
  AuthenticatedWorkspaceRestoreContext,
  WorkspaceSessionRestoreError,
  WorkspaceSessionRestorePlaceholder,
} from '#/web/components/WorkspaceSessionRestore.tsx'
import { AppOverlays } from '#/web/components/AppOverlays.tsx'
import { AuthenticatedWorkspaceSideEffects } from '#/web/components/AuthenticatedWorkspaceSideEffects.tsx'

export function Layout() {
  useSettingsWriteErrorToast()
  useAppHistoryPresentationObserver()

  return (
    <ErrorBoundary>
      <TokenGate>
        <AuthenticatedAppShell />
      </TokenGate>
    </ErrorBoundary>
  )
}

function AuthenticatedAppShell() {
  useWorkspaceFilesystemInvalidationSync()
  const routeMatches = useRouterState({ select: (s) => s.matches })
  const activeWorkspaceSlug = workspaceRouteContextFromMatches(routeMatches)?.workspaceSlug ?? null
  const activeWorkspaceId = activeWorkspaceSlug ? workspaceIdFromSlug(activeWorkspaceSlug) : null
  const bootstrap = useAuthenticatedAppBootstrap({ activeWorkspaceId })
  const bootstrapState = bootstrap.state
  const location = useRouterState({ select: (s) => s.location })
  const shellMode = authenticatedAppShellMode(location.pathname, bootstrapState)

  return (
    <AuthenticatedWorkspaceRestoreContext value={bootstrap}>
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
        {import.meta.env.DEV ? <TanStackRouterDevtools /> : null}
      </TerminalSessionProvider>
    </AuthenticatedWorkspaceRestoreContext>
  )
}

function AuthenticatedSettingsShell() {
  return (
    <div className="relative flex h-full flex-col">
      <Outlet />
      <Toaster position="bottom-right" closeButton />
    </div>
  )
}

function AuthenticatedWorkspaceShell() {
  const routeMatches = useRouterState({ select: (s) => s.matches })
  const routeHref = useRouterState({ select: (s) => s.location.href })
  const overlays = useAppOverlays()
  const modalOpen = overlays.anyOpen

  const routeContext = workspaceRouteContextFromMatches(routeMatches)
  // The routed workspace identity remains the persistence source of truth
  // even before the workspace projection has hydrated into the store.
  const routedWorkspaceId = routeContext ? workspaceIdFromSlug(routeContext.workspaceSlug) : null
  // `hydratedRouteWorkspaceId` means the routed workspace is present in the hydrated workspace store and
  // can safely drive refreshes, dialogs, and commands that need workspace runtime data.
  const hydratedRouteWorkspaceId = useWorkspacesStore((s) => {
    return routedWorkspaceId ? (s.workspaces[routedWorkspaceId]?.id ?? null) : null
  })
  const commandWorkspace = useWorkspacesStore((s) =>
    hydratedRouteWorkspaceId ? s.workspaces[hydratedRouteWorkspaceId] : undefined,
  )
  const currentBranchName = routeContext?.kind === 'branch' ? (routeContext.branchName ?? null) : null
  const currentWorkspacePaneRoute = currentWorkspacePaneRouteFromContext(routeContext)
  const commandCapabilities =
    commandWorkspace?.capability.kind === 'git' || commandWorkspace?.capability.kind === 'filesystem'
      ? commandWorkspace.capability.probe.capabilities
      : null
  const commandWorktreePath = routeContext?.kind === 'worktree' ? routeContext.worktreePath : null
  const commandBranchProjection = useRepoSnapshotReadModel(
    commandWorkspace?.capability.kind === 'git' ? commandWorkspace.id : null,
    commandWorkspace?.workspaceRuntimeId ?? '',
    routeContext?.kind === 'branch' && commandWorkspace?.capability.kind === 'git',
  )
  const commandWorktreeStatus = useRepoWorktreeStatusReadModel(
    commandWorkspace?.capability.kind === 'git' ? commandWorkspace.id : null,
    commandWorkspace?.workspaceRuntimeId ?? '',
    (routeContext?.kind === 'branch' || routeContext?.kind === 'worktree') &&
      commandWorkspace?.capability.kind === 'git',
  )
  const commandWorktree =
    routeContext?.kind === 'worktree' && commandWorktreePath && commandWorktreeStatus.isSuccess
      ? (commandWorktreeStatus.data?.status.find((worktree) => worktree.path === commandWorktreePath) ?? null)
      : null
  const commandBranch =
    commandWorkspace &&
    routeContext?.kind === 'branch' &&
    routeContext.branchName &&
    commandBranchProjection.isSuccess &&
    commandBranchProjection.data?.snapshot
      ? (commandBranchProjection.data.snapshot.branches.find((branch) => branch.name === routeContext.branchName) ??
        null)
      : null
  const commandBranchCandidateWorktreePath = commandBranch?.worktree?.path ?? null
  const commandBranchWorktreePath = routeContext?.kind === 'branch' ? commandBranchCandidateWorktreePath : null
  const currentWorkspacePaneCommandTarget: WorkspacePaneCommandTarget | null =
    routeContext?.kind === 'branch' && routeContext.branchName && commandWorkspace
      ? commandWorkspace?.capability.kind === 'git' && commandBranchWorktreePath
        ? {
            routeTarget: {
              kind: 'git-branch',
              workspaceId: commandWorkspace.id,
              branchName: routeContext.branchName,
            },
            workspacePaneRoute: routeContext.workspacePaneRoute ?? null,
            filesystemTarget: gitWorktreePaneFilesystemTarget({
              workspaceId: commandWorkspace.id,
              workspaceRuntimeId: commandWorkspace.workspaceRuntimeId,
              worktreePath: commandBranchWorktreePath,
              head: gitHead(routeContext.branchName),
              capabilities: commandWorkspace.capability.probe.capabilities,
            }),
          }
        : {
            routeTarget: {
              kind: 'git-branch',
              workspaceId: commandWorkspace.id,
              branchName: routeContext.branchName,
            },
            workspacePaneRoute: routeContext.workspacePaneRoute ?? null,
            filesystemTarget: null,
          }
      : routeContext?.kind === 'worktree' &&
          commandWorkspace?.capability.kind === 'git' &&
          commandWorktreePath &&
          commandWorktree
        ? {
            routeTarget: {
              kind: 'git-worktree',
              workspaceId: commandWorkspace.id,
              worktreePath: commandWorktreePath,
            },
            workspacePaneRoute: routeContext.workspacePaneRoute ?? null,
            filesystemTarget: gitWorktreePaneFilesystemTarget({
              workspaceId: commandWorkspace.id,
              workspaceRuntimeId: commandWorkspace.workspaceRuntimeId,
              worktreePath: commandWorktreePath,
              head: gitHead(commandWorktree.branch ?? null),
              capabilities: commandWorkspace.capability.probe.capabilities,
            }),
          }
        : routeContext?.kind === 'workspace-root' && commandWorkspace && commandCapabilities
          ? {
              routeTarget: { kind: 'workspace-root', workspaceId: commandWorkspace.id },
              workspacePaneRoute: routeContext.workspacePaneRoute ?? null,
              filesystemTarget: workspaceRootPaneFilesystemTarget({
                workspaceId: commandWorkspace.id,
                workspaceRuntimeId: commandWorkspace.workspaceRuntimeId,
                capabilities: commandCapabilities,
              }),
            }
          : null
  const workspaceOrder = useWorkspacesStore((s) => s.workspaceOrder)
  const { closeWorkspace, peekWorkspaceNavigation, commitWorkspaceNavigation } = useWorkspacesStore(
    useShallow(appNavigationStoreActionsFromStore),
  )
  const routeNavigation = useAppRouteActions()
  const layoutRouteCallbacks = appLayoutRouteCallbacks(routeNavigation)
  const navigation = useMemo(
    () =>
      createAppNavigationActions({
        currentWorkspaceId: hydratedRouteWorkspaceId,
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
      hydratedRouteWorkspaceId,
    ],
  )

  const workspaceDrop = useWorkspaceDrop({ blocked: modalOpen })

  return (
    <>
      <AuthenticatedWorkspaceSideEffects
        routedWorkspaceId={routedWorkspaceId}
        hydratedRouteWorkspaceId={hydratedRouteWorkspaceId}
        currentBranchName={currentBranchName}
        currentWorkspacePaneCommandTarget={currentWorkspacePaneCommandTarget}
        routeContext={workspaceNavigationRouteContext(routeContext, routeHref)}
        navigation={navigation}
        closeAllOverlays={overlays.closeAllOverlays}
        openWorkspacePathDialog={overlays.openWorkspacePathDialog}
        openCloneRepo={overlays.openCloneRepo}
        openRemoteWorkspace={overlays.openRemoteWorkspace}
        modalOpen={modalOpen}
        navigateToSettingsShortcuts={layoutRouteCallbacks.navigateToSettingsShortcuts}
        navigateToIndex={layoutRouteCallbacks.navigateToIndex}
      />
      <AppNavigationProvider value={navigation}>
        <LayoutOverlayActions
          value={{
            openWorkspacePathDialog: overlays.openWorkspacePathDialog,
            openCloneRepo: overlays.openCloneRepo,
            openRemoteWorkspace: overlays.openRemoteWorkspace,
            openCreateWorktree: navigation.openCreateWorktree,
          }}
        >
          <AppRuntimeProjectionProvider currentWorkspaceId={hydratedRouteWorkspaceId}>
            <div
              className="relative flex h-full flex-col"
              onDragEnter={workspaceDrop.onDragEnter}
              onDragOver={workspaceDrop.onDragOver}
              onDragLeave={workspaceDrop.onDragLeave}
              onDrop={workspaceDrop.onDrop}
            >
              <Outlet />
              <AppOverlays
                overlays={overlays}
                workspaceDrop={workspaceDrop}
                navigation={navigation}
                hydratedRouteWorkspaceId={hydratedRouteWorkspaceId}
                currentWorkspaceRuntimeId={commandWorkspace?.workspaceRuntimeId ?? null}
                currentBranchName={currentBranchName}
                currentWorkspacePaneRoute={currentWorkspacePaneRoute}
              />
            </div>
          </AppRuntimeProjectionProvider>
        </LayoutOverlayActions>
      </AppNavigationProvider>
    </>
  )
}
