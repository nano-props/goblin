import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { Outlet, useNavigate, useRouterState } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
import { useShallow } from 'zustand/react/shallow'
import { ErrorBoundary } from '#/web/components/ErrorBoundary.tsx'
import { TerminalSessionProvider } from '#/web/components/terminal/TerminalSessionProvider.tsx'
import { TokenGate } from '#/web/components/TokenGate.tsx'
import { RepoCloneDialog } from '#/web/components/RepoCloneDialog.tsx'
import { RepoOpenDialog } from '#/web/components/RepoOpenDialog.tsx'
import { OpenRemoteRepositoryDialog } from '#/web/components/OpenRemoteRepositoryDialog.tsx'
import { BranchActionDialogHost } from '#/web/components/BranchActionDialogHost.tsx'
import { FiletreeActionDialogHost } from '#/web/components/FiletreeActionDialogHost.tsx'
import { TerminalActionDialogHost } from '#/web/components/TerminalActionDialogHost.tsx'
import { RepoDropOverlay } from '#/web/components/RepoDropOverlay.tsx'
import { Toaster } from '#/web/components/ui/sonner.tsx'
import { useAuthenticatedAppBootstrap } from '#/web/hooks/useAuthenticatedAppBootstrap.ts'
import { usePublicAppBootstrap } from '#/web/hooks/usePublicAppBootstrap.ts'
import { useAppOverlays } from '#/web/hooks/useAppOverlays.ts'
import { useBackgroundFetch } from '#/web/hooks/useBackgroundFetch.ts'
import { useNetworkReconnect } from '#/web/hooks/useNetworkReconnect.ts'
import { useRepoStatusRefresh } from '#/web/hooks/useRepoStatusRefresh.ts'
import { useKeyboard } from '#/web/hooks/useKeyboard.ts'
import { useClientEffectIntentRouter } from '#/web/hooks/useClientEffectIntentRouter.ts'
import { useRepoDrop } from '#/web/hooks/useRepoDrop.ts'
import { useRepoStoreInvalidationRefresh } from '#/web/hooks/useRepoStoreInvalidationRefresh.ts'
import { useSessionPersistence } from '#/web/hooks/useSessionPersistence.ts'
import { useSettingsWriteErrorToast } from '#/web/hooks/useSettingsWriteErrorToast.ts'
import { useSettingsQueryInvalidationSync } from '#/web/settings-queries.ts'
import { createPrimaryWindowNavigationActions } from '#/web/primary-window-navigation-actions.ts'
import {
  PrimaryWindowNavigationProvider,
  type PrimaryWindowNavigationActions,
} from '#/web/primary-window-navigation.tsx'
import { LayoutOverlayActions } from '#/web/layout-overlay-actions-context.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { primaryWindowNavigationStoreActionsFromStore } from '#/web/stores/repos/selector-actions.ts'
import { branchNameFromSlug, repoIdFromSlug } from '#/web/repo-route-slugs.ts'
import { usePrimaryWindowRouteNavigation } from '#/web/primary-window-route-navigation.ts'
import type { AuthenticatedAppBootstrapState } from '#/web/hooks/useAuthenticatedAppBootstrap.ts'

const AuthenticatedWorkspaceBootContext = createContext<AuthenticatedAppBootstrapState>('booting')

export type AuthenticatedAppShellMode = 'settings' | 'workspace-boot' | 'workspace-ready'

export function authenticatedAppShellMode(
  pathname: string,
  bootstrapState: AuthenticatedAppBootstrapState,
): AuthenticatedAppShellMode {
  if (pathname.startsWith('/settings')) return 'settings'
  return bootstrapState === 'booting' ? 'workspace-boot' : 'workspace-ready'
}

export function Layout() {
  usePublicAppBootstrap()
  useSettingsWriteErrorToast()

  return (
    <ErrorBoundary>
      <TokenGate>
        <AuthenticatedAppShell />
      </TokenGate>
    </ErrorBoundary>
  )
}

function AuthenticatedAppShell() {
  const bootstrapState = useAuthenticatedAppBootstrap()
  const location = useRouterState({ select: (s) => s.location })
  const shellMode = authenticatedAppShellMode(location.pathname, bootstrapState)

  return (
    <AuthenticatedWorkspaceBootContext value={bootstrapState}>
      {shellMode === 'settings' ? (
        <AuthenticatedSettingsShell />
      ) : shellMode === 'workspace-boot' ? (
        <WorkspaceBootPlaceholder />
      ) : (
        <AuthenticatedWorkspaceShell />
      )}
      {import.meta.env.DEV ? <TanStackRouterDevtools /> : null}
    </AuthenticatedWorkspaceBootContext>
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
  const navigate = useNavigate()
  const routeMatches = useRouterState({ select: (s) => s.matches })

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
  const currentBranchName = routeContext?.kind === 'branch' ? (routeContext.branchName ?? null) : null
  const order = useReposStore((s) => s.order)
  const { closeRepo, setWorkspacePaneTab } = useReposStore(
    useShallow(primaryWindowNavigationStoreActionsFromStore),
  )
  const routeNavigation = usePrimaryWindowRouteNavigation()
  const navigation = useMemo(
    () =>
      createPrimaryWindowNavigationActions({
        currentRepoId: hydratedRouteRepoId,
        order,
        closeRepo,
        setWorkspacePaneTab,
        routeNavigation,
      }),
    [closeRepo, order, routeNavigation, setWorkspacePaneTab, hydratedRouteRepoId],
  )

  const repoDrop = useRepoDrop({ blocked: modalOpen })

  return (
    <>
      <AuthenticatedWorkspaceSideEffects
        routedRepoId={routedRepoId}
        hydratedRouteRepoId={hydratedRouteRepoId}
        currentBranchName={currentBranchName}
        navigation={navigation}
        closeAllOverlays={overlays.closeAllOverlays}
        openRepoPathDialog={overlays.openRepoPathDialog}
        openCloneRepo={overlays.openCloneRepo}
        openRemoteRepo={overlays.openRemoteRepo}
        modalOpen={modalOpen}
        isSettingsOpen={false}
        navigateToSettingsShortcuts={() => void navigate({ to: '/settings/shortcuts' })}
        navigateToIndex={() => void navigate({ to: '/' })}
      />
      <PrimaryWindowNavigationProvider value={navigation}>
        <LayoutOverlayActions
          value={{
            openRepoPathDialog: overlays.openRepoPathDialog,
            openCloneRepo: overlays.openCloneRepo,
            openRemoteRepo: overlays.openRemoteRepo,
            openCreateWorktree: navigation.openCreateWorktree,
          }}
        >
          <TerminalSessionProvider currentRepoId={hydratedRouteRepoId}>
            <div
              className="relative flex h-full flex-col"
              onDragEnter={repoDrop.onDragEnter}
              onDragOver={repoDrop.onDragOver}
              onDragLeave={repoDrop.onDragLeave}
              onDrop={repoDrop.onDrop}
            >
              <Outlet />
              <PrimaryWindowOverlays
                overlays={overlays}
                repoDrop={repoDrop}
                navigation={navigation}
                hydratedRouteRepoId={hydratedRouteRepoId}
                currentBranchName={currentBranchName}
              />
            </div>
          </TerminalSessionProvider>
        </LayoutOverlayActions>
      </PrimaryWindowNavigationProvider>
    </>
  )
}

export function AuthenticatedWorkspaceBootGate({ children }: { children: ReactNode }) {
  const bootstrapState = useContext(AuthenticatedWorkspaceBootContext)
  if (bootstrapState === 'booting') return <WorkspaceBootPlaceholder />
  return <>{children}</>
}

function WorkspaceBootPlaceholder() {
  return (
    <div className="flex h-full items-center justify-center text-muted-foreground" role="status" aria-live="polite">
      <span>…</span>
    </div>
  )
}

interface RepoRouteContext {
  kind: 'dashboard' | 'branch' | 'newWorktree'
  repoSlug: string
  branchName?: string
}

function repoRouteContextFromMatches(matches: Array<{ routeId: string; params: Record<string, string> }>): RepoRouteContext | null {
  const repoMatch = [...matches].reverse().find((match) => typeof match.params.repoSlug === 'string')
  if (!repoMatch) return null

  const repoSlug = repoMatch.params.repoSlug
  if (!repoSlug) return null

  const branchSlug = repoMatch.params.branchSlug
  if (branchSlug) {
    const branchName = branchNameFromSlug(branchSlug)
    return branchName ? { kind: 'branch', repoSlug, branchName } : null
  }

  return repoMatch.routeId.includes('/worktree/new')
    ? { kind: 'newWorktree', repoSlug }
    : { kind: 'dashboard', repoSlug }
}

interface PrimaryWindowOverlaysProps {
  overlays: ReturnType<typeof useAppOverlays>
  repoDrop: ReturnType<typeof useRepoDrop>
  navigation: PrimaryWindowNavigationActions
  hydratedRouteRepoId: string | null
  currentBranchName: string | null
}

function PrimaryWindowOverlays({
  overlays,
  repoDrop,
  navigation,
  hydratedRouteRepoId,
  currentBranchName,
}: PrimaryWindowOverlaysProps) {
  return (
    <>
      <RepoOpenDialog open={overlays.state.openRepo.open} onOpenChange={overlays.setOpenRepoOpen} />
      <RepoCloneDialog open={overlays.state.clone.open} onOpenChange={overlays.setCloneOpen} />
      <OpenRemoteRepositoryDialog
        open={overlays.state.openRemoteRepo.open}
        onOpenChange={overlays.setOpenRemoteRepoOpen}
      />
      <BranchActionDialogHost currentRepoId={hydratedRouteRepoId} currentBranchName={currentBranchName} />
      <FiletreeActionDialogHost currentRepoId={hydratedRouteRepoId} />
      <TerminalActionDialogHost currentRepoId={hydratedRouteRepoId} navigation={navigation} />
      <RepoDropOverlay active={repoDrop.active} />
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
  navigation,
  closeAllOverlays,
  openRepoPathDialog,
  openCloneRepo,
  openRemoteRepo,
  modalOpen,
  isSettingsOpen,
  navigateToSettingsShortcuts,
  navigateToIndex,
}: {
  routedRepoId: string | null
  hydratedRouteRepoId: string | null
  currentBranchName: string | null
  navigation: PrimaryWindowNavigationActions
  closeAllOverlays: () => void
  openRepoPathDialog: () => void
  openCloneRepo: () => void
  openRemoteRepo: () => void
  modalOpen: boolean
  isSettingsOpen: boolean
  navigateToSettingsShortcuts: () => void
  navigateToIndex: () => void
}): null {
  const workspaceShortcutsSuppressed = modalOpen || isSettingsOpen
  useClientEffectIntentRouter({
    navigation,
    currentRepoId: hydratedRouteRepoId,
    currentBranchName,
    closeAllOverlays,
    openRepoPathDialog,
    openCloneRepo,
    openRemoteRepo,
    openCreateWorktree: navigation.openCreateWorktree,
    isOverlayOpen: () => modalOpen,
    isWorkspaceShortcutSuppressed: () => workspaceShortcutsSuppressed,
  })

  useKeyboard({
    navigation,
    currentRepoId: hydratedRouteRepoId,
    currentBranchName,
    onShowHelp: navigateToSettingsShortcuts,
    isWorkspaceShortcutSuppressed: () => workspaceShortcutsSuppressed,
    isSettingsOpen: () => isSettingsOpen,
    onExitSettings: navigateToIndex,
    openCreateWorktree: navigation.openCreateWorktree,
  })

  useSessionPersistence({ routedRepoId })
  useBackgroundFetch({ hydratedRouteRepoId })
  useRepoStatusRefresh({ hydratedRouteRepoId, currentBranchName })
  useNetworkReconnect()
  useRepoStoreInvalidationRefresh()
  useSettingsQueryInvalidationSync()
  return null
}
