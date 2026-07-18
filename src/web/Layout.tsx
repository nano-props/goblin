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
import { usePublicAppBootstrap } from '#/web/hooks/usePublicAppBootstrap.ts'
import { useAppOverlays } from '#/web/hooks/useAppOverlays.ts'
import { useBackgroundFetch } from '#/web/hooks/useBackgroundFetch.ts'
import { useNetworkReconnect } from '#/web/hooks/useNetworkReconnect.ts'
import { useKeyboard } from '#/web/hooks/useKeyboard.ts'
import { useClientEffectIntentRouter } from '#/web/hooks/useClientEffectIntentRouter.ts'
import { useWorkspaceDrop } from '#/web/hooks/useWorkspaceDrop.ts'
import { useRepoStoreInvalidationRefresh } from '#/web/hooks/useRepoStoreInvalidationRefresh.ts'
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
import { useReposStore } from '#/web/stores/repos/store.ts'
import { useT } from '#/web/stores/i18n.ts'
import { primaryWindowNavigationStoreActionsFromStore } from '#/web/stores/repos/selector-actions.ts'
import { branchNameFromSlug, repoIdFromSlug, worktreePathFromSlug } from '#/web/repo-route-slugs.ts'
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
import { readRepoBranchSnapshotQueryProjection } from '#/web/repo-branch-read-model.ts'
import { parseCanonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'
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
  usePublicAppBootstrap()
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
  const routeMatches = useRouterState({ select: (s) => s.matches })
  const activeRepoSlug = repoRouteContextFromMatches(routeMatches)?.repoSlug ?? null
  const activeRepoRoot = activeRepoSlug ? repoIdFromSlug(activeRepoSlug) : null
  const bootstrap = useAuthenticatedAppBootstrap({ activeRepoRoot })
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

  const routeContext = repoRouteContextFromMatches(routeMatches)
  // `routedRepoId` is the canonical repo id encoded in the URL. It is the
  // source of truth for session persistence even before repo hydration has
  // populated `repos[routedRepoId]`.
  const routedRepoId = routeContext ? repoIdFromSlug(routeContext.repoSlug) : null
  // `hydratedRouteRepoId` means the routed repo is present in the hydrated repo store and
  // can safely drive refreshes, dialogs, and commands that need repo data.
  const hydratedRouteRepoId = useReposStore((s) => {
    return routedRepoId && s.repos[routedRepoId] ? routedRepoId : null
  })
  const commandRepo = useReposStore((s) => (hydratedRouteRepoId ? s.repos[hydratedRouteRepoId] : undefined))
  const currentBranchName = routeContext?.kind === 'branch' ? (routeContext.branchName ?? null) : null
  const currentWorkspacePaneRoute = routeContext?.kind === 'branch' ? (routeContext.workspacePaneRoute ?? null) : null
  const commandCapabilities =
    commandRepo?.workspaceProbe.status === 'ready' ? commandRepo.workspaceProbe.capabilities : null
  const commandWorkspace = commandRepo ? parseCanonicalWorkspaceLocator(commandRepo.id) : null
  const commandWorktreePath = routeContext?.kind === 'worktree' ? routeContext.worktreePath : null
  const commandBranch =
    commandRepo && routeContext?.kind === 'branch' && routeContext.branchName
      ? (readRepoBranchSnapshotQueryProjection(commandRepo)?.branches.find(
          (branch) => branch.name === routeContext.branchName,
        ) ?? null)
      : null
  const currentWorkspacePaneCommandTarget: WorkspacePaneCommandTarget | null =
    routeContext?.kind === 'branch' && routeContext.branchName
      ? commandRepo && commandCapabilities && commandBranch?.worktree?.path
        ? {
            kind: 'git-worktree',
            workspacePaneRoute: routeContext.workspacePaneRoute ?? null,
            filesystemTarget: {
              kind: 'git-worktree',
              workspaceId: commandRepo.id,
              workspaceRuntimeId: commandRepo.workspaceRuntimeId,
              rootPath: commandBranch.worktree.path,
              head: gitHead(commandBranch.name),
              capabilities: commandCapabilities,
            },
          }
        : {
            kind: 'git-branch',
            branchName: routeContext.branchName,
            workspacePaneRoute: routeContext.workspacePaneRoute ?? null,
          }
      : routeContext?.kind === 'worktree' && commandRepo && commandCapabilities && commandWorktreePath
        ? {
            kind: 'git-worktree',
            workspacePaneRoute: routeContext.workspacePaneRoute ?? null,
            filesystemTarget: {
              kind: 'git-worktree',
              workspaceId: commandRepo.id,
              workspaceRuntimeId: commandRepo.workspaceRuntimeId,
              rootPath: commandWorktreePath,
              head: { kind: 'detached' },
              capabilities: commandCapabilities,
            },
          }
        : routeContext?.kind === 'workspace-root' && commandRepo && commandCapabilities && commandWorkspace
          ? {
              kind: 'workspace-root',
              workspacePaneRoute: null,
              filesystemTarget: {
                kind: 'workspace-root',
                workspaceId: commandRepo.id,
                workspaceRuntimeId: commandRepo.workspaceRuntimeId,
                rootPath: commandWorkspace.path,
                capabilities: commandCapabilities,
              },
            }
          : null
  const order = useReposStore((s) => s.order)
  const { closeWorkspace, peekWorkspaceNavigation, commitWorkspaceNavigation } = useReposStore(
    useShallow(primaryWindowNavigationStoreActionsFromStore),
  )
  const routeNavigation = usePrimaryWindowRouteActions()
  const layoutRouteCallbacks = primaryWindowLayoutRouteCallbacks(routeNavigation)
  const navigation = useMemo(
    () =>
      createPrimaryWindowNavigationActions({
        currentWorkspaceId: hydratedRouteRepoId,
        order,
        closeWorkspace,
        peekWorkspaceNavigation,
        commitWorkspaceNavigation,
        routeNavigation,
      }),
    [closeWorkspace, peekWorkspaceNavigation, commitWorkspaceNavigation, order, routeNavigation, hydratedRouteRepoId],
  )

  const workspaceDrop = useWorkspaceDrop({ blocked: modalOpen })

  return (
    <>
      <AuthenticatedWorkspaceSideEffects
        routedRepoId={routedRepoId}
        hydratedRouteRepoId={hydratedRouteRepoId}
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
          <AppRuntimeProjectionProvider currentRepoId={hydratedRouteRepoId}>
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
                hydratedRouteRepoId={hydratedRouteRepoId}
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

type RepoRouteContext =
  | { kind: 'empty' | 'workspace-root' | 'dashboard' | 'newWorktree'; repoSlug: string }
  | { kind: 'branch'; repoSlug: string; branchName: string; workspacePaneRoute: ParsedWorkspacePaneRoute | null }
  | { kind: 'worktree'; repoSlug: string; worktreePath: string; workspacePaneRoute: ParsedWorkspacePaneRoute | null }

export function repoRouteContextFromMatches(
  matches: Array<{ routeId: string; params: Record<string, string> }>,
): RepoRouteContext | null {
  const repoMatch = [...matches].reverse().find((match) => typeof match.params.repoSlug === 'string')
  if (!repoMatch) return null

  const repoSlug = repoMatch.params.repoSlug
  if (!repoSlug) return null

  const branchSlug = repoMatch.params.branchSlug
  if (branchSlug) {
    const branchName = branchNameFromSlug(branchSlug)
    return branchName
      ? {
          kind: 'branch',
          repoSlug,
          branchName,
          workspacePaneRoute: workspacePaneRouteFromMatches(matches),
        }
      : { kind: 'empty', repoSlug }
  }

  const worktreeSlug = repoMatch.params.worktreeSlug
  if (worktreeSlug) {
    const worktreePath = worktreePathFromSlug(worktreeSlug)
    return worktreePath
      ? { kind: 'worktree', repoSlug, worktreePath, workspacePaneRoute: workspacePaneRouteFromMatches(matches) }
      : { kind: 'empty', repoSlug }
  }

  if (repoMatch.routeId.includes('/worktree/new')) return { kind: 'newWorktree', repoSlug }
  if (repoMatch.routeId.includes('/dashboard')) return { kind: 'dashboard', repoSlug }
  if (repoMatch.routeId.includes('/workspace')) return { kind: 'workspace-root', repoSlug }
  return { kind: 'empty', repoSlug }
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
  hydratedRouteRepoId: string | null
  currentBranchName: string | null
  currentWorkspacePaneRoute: ParsedWorkspacePaneRoute | null
}

function PrimaryWindowOverlays({
  overlays,
  workspaceDrop,
  navigation,
  hydratedRouteRepoId,
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
      <BranchActionDialogHost currentRepoId={hydratedRouteRepoId} currentBranchName={currentBranchName} />
      <FiletreeActionDialogHost currentRepoId={hydratedRouteRepoId} />
      <TerminalActionDialogHost
        currentRepoId={hydratedRouteRepoId}
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
  routedRepoId,
  hydratedRouteRepoId,
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
  routedRepoId: string | null
  hydratedRouteRepoId: string | null
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
    currentWorkspaceId: hydratedRouteRepoId,
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
    currentWorkspaceId: hydratedRouteRepoId,
    currentBranchName,
    currentWorkspacePaneCommandTarget,
    onShowHelp: navigateToSettingsShortcuts,
    isWorkspaceShortcutSuppressed: () => workspaceShortcutsSuppressed,
    isSettingsOpen: () => isSettingsOpen,
    onExitSettings: navigateToIndex,
    openCreateWorktree: navigation.openCreateWorktree,
  })

  useClientWorkspacePersistence({ routedRepoId })
  useWorkspaceNavigationHistory({ routeContext })
  useBackgroundFetch({ hydratedRouteRepoId })
  useNetworkReconnect()
  useRepoProjectionQueryEffects()
  useRepoStoreInvalidationRefresh()
  useSettingsQueryInvalidationSync()
  return null
}

function workspaceNavigationRouteContext(
  routeContext: RepoRouteContext | null,
  routeHref: string | null,
): WorkspaceNavigationRouteContext | null {
  if (!routeContext) return null
  const repoId = repoIdFromSlug(routeContext.repoSlug)
  if (!repoId) return null
  if (routeContext.kind === 'branch') {
    return null
  }
  if (routeContext.kind === 'worktree') {
    return {
      kind: 'worktree',
      repoId,
      worktreePath: routeContext.worktreePath,
      workspacePaneRoute:
        routeContext.workspacePaneRoute?.kind === 'invalid-static' ? null : (routeContext.workspacePaneRoute ?? null),
    }
  }
  if (routeContext.kind === 'newWorktree') {
    return { kind: 'newWorktree', repoId, returnTo: returnToFromHref(routeHref) }
  }
  return { kind: routeContext.kind, repoId }
}
