import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Outlet, useRouterState } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
import { useShallow } from 'zustand/react/shallow'
import { ErrorBoundary } from '#/web/components/ErrorBoundary.tsx'
import { CenteredLoadingStatus } from '#/web/components/CenteredLoadingStatus.tsx'
import { EmptyState } from '#/web/components/Layout.tsx'
import { Button } from '#/web/components/ui/button.tsx'
import { TerminalSessionProvider } from '#/web/components/terminal/TerminalSessionProvider.tsx'
import { AppRuntimeProjectionProvider } from '#/web/runtime/AppRuntimeProjectionProvider.tsx'
import { TokenGate } from '#/web/components/TokenGate.tsx'
import { RepoCloneDialog } from '#/web/components/RepoCloneDialog.tsx'
import { WorkspaceOpenDialog } from '#/web/components/WorkspaceOpenDialog.tsx'
import { OpenRemoteWorkspaceDialog } from '#/web/components/OpenRemoteWorkspaceDialog.tsx'
import { BranchActionDialogHost } from '#/web/components/BranchActionDialogHost.tsx'
import { FiletreeActionDialogHost } from '#/web/components/FiletreeActionDialogHost.tsx'
import { TerminalActionDialogHost } from '#/web/components/TerminalActionDialogHost.tsx'
import { WorkspaceDropOverlay } from '#/web/components/WorkspaceDropOverlay.tsx'
import { Toaster } from '#/web/components/ui/sonner.tsx'
import { useAuthenticatedAppBootstrap } from '#/web/hooks/useAuthenticatedAppBootstrap.ts'
import { useAppOverlays } from '#/web/hooks/useAppOverlays.ts'
import { useBackgroundFetch } from '#/web/hooks/useBackgroundFetch.ts'
import { useNetworkReconnect } from '#/web/hooks/useNetworkReconnect.ts'
import { useKeyboard } from '#/web/hooks/useKeyboard.ts'
import { useClientEffectIntentRouter } from '#/web/hooks/useClientEffectIntentRouter.ts'
import { useWorkspaceDrop } from '#/web/hooks/useWorkspaceDrop.ts'
import { useRepoStoreInvalidationRefresh } from '#/web/hooks/useRepoStoreInvalidationRefresh.ts'
import { useWorkspaceRuntimeInvalidationRefresh } from '#/web/hooks/useWorkspaceRuntimeInvalidationRefresh.ts'
import { useWorkspaceFilesystemInvalidationSync } from '#/web/hooks/useWorkspaceFilesystemInvalidationSync.ts'
import { useRepoProjectionQueryEffects } from '#/web/repo-projection-query-effects.ts'
import { useClientWorkspacePersistence } from '#/web/hooks/useClientWorkspacePersistence.ts'
import { useSettingsWriteErrorToast } from '#/web/hooks/useSettingsWriteErrorToast.ts'
import { useSettingsQueryInvalidationSync } from '#/web/settings-queries.ts'
import { createPrimaryWindowNavigationActions } from '#/web/primary-window-navigation-actions.ts'
import {
  PrimaryWindowNavigationProvider,
  type PrimaryWindowNavigationActions,
} from '#/web/primary-window-navigation.tsx'
import { LayoutOverlayActions } from '#/web/layout-overlay-actions-context.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { useT } from '#/web/stores/i18n.ts'
import { primaryWindowNavigationStoreActionsFromStore } from '#/web/stores/workspaces/selector-actions.ts'
import { branchNameFromSlug, workspaceIdFromSlug, worktreePathFromSlug } from '#/web/workspace-route-slugs.ts'
import { returnToFromHref, usePrimaryWindowRouteActions } from '#/web/primary-window-route-navigation.ts'
import {
  usePrimaryWindowHistoryPresentationObserver,
  useWorkspaceNavigationHistory,
} from '#/web/workspace-navigation-history.ts'
import type { WorkspaceNavigationRouteContext } from '#/web/workspace-navigation-history.ts'
import type {
  AuthenticatedAppBootstrapResult,
  AuthenticatedAppBootstrapState,
} from '#/web/hooks/useAuthenticatedAppBootstrap.ts'
import type { ParsedWorkspacePaneRoute } from '#/web/App.tsx'
import type { WorkspacePaneCommandTarget } from '#/web/workspace-pane/workspace-pane-command-target.ts'
import { isWorkspacePaneStaticTabType } from '#/shared/workspace-pane.ts'
import type { PrimaryWindowRouteNavigation } from '#/web/primary-window-route-navigation.ts'
import { repoBranchSnapshotDataFromSnapshot } from '#/web/repo-branch-read-model.ts'
import { useRepoProjectionReadModel, useRepoWorktreeStatusReadModel } from '#/web/repo-queries.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import {
  gitWorktreePaneFilesystemTarget,
  workspaceRootPaneFilesystemTarget,
} from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'
import { gitHead } from '#/shared/git-head.ts'

const AuthenticatedWorkspaceRestoreContext = createContext<AuthenticatedAppBootstrapResult>({
  state: { status: 'restoring-workspace' },
  retry: () => {},
})

export type AuthenticatedAppShellMode = 'settings' | 'workspace-restore' | 'workspace-failed' | 'workspace-ready'

export function primaryWindowLayoutRouteCallbacks(
  routeActions: Pick<PrimaryWindowRouteNavigation, 'openSettings' | 'openHome'>,
) {
  return {
    navigateToSettingsShortcuts: () => routeActions.openSettings('shortcuts'),
    navigateToIndex: () => routeActions.openHome(),
  }
}

export function authenticatedAppShellMode(
  pathname: string,
  bootstrapState: AuthenticatedAppBootstrapState,
): AuthenticatedAppShellMode {
  if (pathname.startsWith('/settings')) return 'settings'
  if (bootstrapState.status === 'restoring-workspace') return 'workspace-restore'
  return bootstrapState.status === 'failed' ? 'workspace-failed' : 'workspace-ready'
}

export function Layout() {
  useSettingsWriteErrorToast()
  usePrimaryWindowHistoryPresentationObserver()

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
  const commandBranchProjection = useRepoProjectionReadModel(
    commandWorkspace?.capability.kind === 'git' ? commandWorkspace.id : null,
    commandWorkspace?.workspaceRuntimeId ?? '',
    routeContext?.kind === 'branch' ? routeContext.branchName : null,
    'full',
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
    commandWorktreeStatus.isSuccess &&
    commandBranchProjection.data?.snapshot &&
    commandWorktreeStatus.data
      ? (repoBranchSnapshotDataFromSnapshot(commandBranchProjection.data.snapshot).branches.find(
          (branch) => branch.name === routeContext.branchName,
        ) ?? null)
      : null
  const commandBranchCandidateWorktreePath = commandBranch?.worktree?.path ?? null
  const commandBranchWorktreePath =
    routeContext?.kind === 'branch' &&
    commandBranchCandidateWorktreePath &&
    commandWorktreeStatus.data?.status.some(
      (worktree) => worktree.path === commandBranchCandidateWorktreePath && worktree.branch === routeContext.branchName,
    )
      ? commandBranchCandidateWorktreePath
      : null
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
    useShallow(primaryWindowNavigationStoreActionsFromStore),
  )
  const routeNavigation = usePrimaryWindowRouteActions()
  const layoutRouteCallbacks = primaryWindowLayoutRouteCallbacks(routeNavigation)
  const navigation = useMemo(
    () =>
      createPrimaryWindowNavigationActions({
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
        isSettingsOpen={false}
        navigateToSettingsShortcuts={layoutRouteCallbacks.navigateToSettingsShortcuts}
        navigateToIndex={layoutRouteCallbacks.navigateToIndex}
      />
      <PrimaryWindowNavigationProvider value={navigation}>
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
              <PrimaryWindowOverlays
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
      </PrimaryWindowNavigationProvider>
    </>
  )
}

export function WorkspaceSessionRestoreGate({ children }: { children: ReactNode }) {
  const bootstrap = useContext(AuthenticatedWorkspaceRestoreContext)
  const bootstrapState = bootstrap.state
  if (bootstrapState.status === 'restoring-workspace') return <WorkspaceSessionRestorePlaceholder />
  if (bootstrapState.status === 'failed') {
    return <WorkspaceSessionRestoreError state={bootstrapState} retry={bootstrap.retry} />
  }
  return <>{children}</>
}

function WorkspaceSessionRestorePlaceholder() {
  return <CenteredLoadingStatus label="Restoring workspace" />
}

function WorkspaceSessionRestoreError({
  state,
  retry,
}: {
  state: Extract<AuthenticatedAppBootstrapState, { status: 'failed' }>
  retry: () => void
}) {
  const t = useT()
  return (
    <div className="flex h-full items-center justify-center p-8">
      <EmptyState
        icon={<AlertTriangle size={18} />}
        title={t('workspace-restore.failed')}
        body={
          <div className="space-y-3">
            <div className="break-words">{state.message}</div>
            <Button type="button" variant="outline" onClick={retry}>
              <RefreshCw />
              {t('error.try-again')}
            </Button>
          </div>
        }
      />
    </div>
  )
}

type WorkspaceRouteContext =
  | { kind: 'empty' | 'dashboard' | 'newWorktree'; workspaceSlug: string }
  | { kind: 'workspace-root'; workspaceSlug: string; workspacePaneRoute: ParsedWorkspacePaneRoute | null }
  | { kind: 'branch'; workspaceSlug: string; branchName: string; workspacePaneRoute: ParsedWorkspacePaneRoute | null }
  | {
      kind: 'worktree'
      workspaceSlug: string
      worktreePath: string
      workspacePaneRoute: ParsedWorkspacePaneRoute | null
    }

export function currentWorkspacePaneRouteFromContext(
  routeContext: WorkspaceRouteContext | null,
): ParsedWorkspacePaneRoute | null {
  return routeContext && 'workspacePaneRoute' in routeContext ? routeContext.workspacePaneRoute : null
}

export function workspaceRouteContextFromMatches(
  matches: Array<{ routeId: string; params: Record<string, string> }>,
): WorkspaceRouteContext | null {
  const workspaceMatch = [...matches].reverse().find((match) => typeof match.params.workspaceSlug === 'string')
  if (!workspaceMatch) return null

  const workspaceSlug = workspaceMatch.params.workspaceSlug
  if (!workspaceSlug) return null

  const branchSlug = workspaceMatch.params.branchSlug
  if (branchSlug) {
    const branchName = branchNameFromSlug(branchSlug)
    return branchName
      ? {
          kind: 'branch',
          workspaceSlug,
          branchName,
          workspacePaneRoute: workspacePaneRouteFromMatches(matches),
        }
      : { kind: 'empty', workspaceSlug }
  }

  const worktreeSlug = workspaceMatch.params.worktreeSlug
  if (worktreeSlug) {
    const worktreePath = worktreePathFromSlug(worktreeSlug)
    return worktreePath
      ? { kind: 'worktree', workspaceSlug, worktreePath, workspacePaneRoute: workspacePaneRouteFromMatches(matches) }
      : { kind: 'empty', workspaceSlug }
  }

  if (workspaceMatch.routeId.includes('/worktree/new')) return { kind: 'newWorktree', workspaceSlug }
  if (workspaceMatch.routeId.includes('/dashboard')) return { kind: 'dashboard', workspaceSlug }
  if (workspaceMatch.routeId.includes('/root')) {
    return { kind: 'workspace-root', workspaceSlug, workspacePaneRoute: workspacePaneRouteFromMatches(matches) }
  }
  return { kind: 'empty', workspaceSlug }
}

function workspacePaneRouteFromMatches(
  matches: Array<{ routeId: string; params: Record<string, string> }>,
): ParsedWorkspacePaneRoute | null {
  const terminalMatch = [...matches].reverse().find((match) => typeof match.params.terminalSessionId === 'string')
  const terminalSessionId = terminalMatch?.params.terminalSessionId
  if (terminalSessionId) return { kind: 'terminal', terminalSessionId }

  const tabMatch = [...matches].reverse().find((match) => typeof match.params.tabKey === 'string')
  const tabKey = tabMatch?.params.tabKey
  if (!tabKey) return null
  return isWorkspacePaneStaticTabType(tabKey) ? { kind: 'static', tab: tabKey } : { kind: 'invalid-static', tabKey }
}

interface PrimaryWindowOverlaysProps {
  overlays: ReturnType<typeof useAppOverlays>
  workspaceDrop: ReturnType<typeof useWorkspaceDrop>
  navigation: PrimaryWindowNavigationActions
  hydratedRouteWorkspaceId: WorkspaceId | null
  currentWorkspaceRuntimeId: string | null
  currentBranchName: string | null
  currentWorkspacePaneRoute: ParsedWorkspacePaneRoute | null
}

function PrimaryWindowOverlays({
  overlays,
  workspaceDrop,
  navigation,
  hydratedRouteWorkspaceId,
  currentWorkspaceRuntimeId,
  currentBranchName,
  currentWorkspacePaneRoute,
}: PrimaryWindowOverlaysProps) {
  return (
    <>
      <WorkspaceOpenDialog open={overlays.state.openWorkspace.open} onOpenChange={overlays.setOpenWorkspaceOpen} />
      <RepoCloneDialog open={overlays.state.clone.open} onOpenChange={overlays.setCloneOpen} />
      <OpenRemoteWorkspaceDialog
        open={overlays.state.openRemoteWorkspace.open}
        onOpenChange={overlays.setOpenRemoteWorkspaceOpen}
      />
      <BranchActionDialogHost currentWorkspaceId={hydratedRouteWorkspaceId} currentBranchName={currentBranchName} />
      <FiletreeActionDialogHost
        currentWorkspaceId={hydratedRouteWorkspaceId}
        currentWorkspaceRuntimeId={currentWorkspaceRuntimeId}
      />
      <TerminalActionDialogHost
        currentWorkspaceId={hydratedRouteWorkspaceId}
        currentWorkspacePaneRoute={currentWorkspacePaneRoute}
        navigation={navigation}
      />
      <WorkspaceDropOverlay active={workspaceDrop.active} />
      <Toaster position="bottom-right" closeButton />
    </>
  )
}

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
 * It renders `null` and is colocated with `Layout` because no
 * other subtree needs the same set of subscriptions.
 */
function AuthenticatedWorkspaceSideEffects({
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
  isSettingsOpen,
  navigateToSettingsShortcuts,
  navigateToIndex,
}: {
  routedWorkspaceId: WorkspaceId | null
  hydratedRouteWorkspaceId: WorkspaceId | null
  currentBranchName: string | null
  currentWorkspacePaneCommandTarget: WorkspacePaneCommandTarget | null
  routeContext: WorkspaceNavigationRouteContext | null
  navigation: PrimaryWindowNavigationActions
  closeAllOverlays: () => void
  openWorkspacePathDialog: () => void
  openCloneRepo: () => void
  openRemoteWorkspace: () => void
  modalOpen: boolean
  isSettingsOpen: boolean
  navigateToSettingsShortcuts: () => void
  navigateToIndex: () => void
}): null {
  const workspaceShortcutsSuppressed = modalOpen || isSettingsOpen
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
    isSettingsOpen: () => isSettingsOpen,
    onExitSettings: navigateToIndex,
    openCreateWorktree: navigation.openCreateWorktree,
  })

  useClientWorkspacePersistence({ routedWorkspaceId })
  useWorkspaceNavigationHistory({ routeContext })
  useBackgroundFetch({ currentWorkspaceId: hydratedRouteWorkspaceId })
  useNetworkReconnect()
  useRepoProjectionQueryEffects()
  useRepoStoreInvalidationRefresh()
  useWorkspaceRuntimeInvalidationRefresh()
  useSettingsQueryInvalidationSync()
  return null
}

function workspaceNavigationRouteContext(
  routeContext: WorkspaceRouteContext | null,
  routeHref: string | null,
): WorkspaceNavigationRouteContext | null {
  if (!routeContext) return null
  const workspaceId = workspaceIdFromSlug(routeContext.workspaceSlug)
  if (!workspaceId) return null
  if (routeContext.kind === 'branch' || routeContext.kind === 'workspace-root' || routeContext.kind === 'worktree') {
    return null
  }
  if (routeContext.kind === 'newWorktree') {
    return { kind: 'newWorktree', workspaceId, returnTo: returnToFromHref(routeHref) }
  }
  return { kind: routeContext.kind, workspaceId }
}
