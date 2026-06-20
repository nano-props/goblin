import { useMemo } from 'react'
import { Outlet, useNavigate, useRouterState } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { ErrorBoundary } from '#/web/components/ErrorBoundary.tsx'
import { TerminalSessionProvider } from '#/web/components/terminal/TerminalSessionProvider.tsx'
import { TokenGate } from '#/web/components/TokenGate.tsx'
import { RepoCloneDialog } from '#/web/components/RepoCloneDialog.tsx'
import { RepoOpenDialog } from '#/web/components/RepoOpenDialog.tsx'
import { OpenRemoteRepositoryDialog } from '#/web/components/OpenRemoteRepositoryDialog.tsx'
import { RepoDropOverlay } from '#/web/components/RepoDropOverlay.tsx'
import { Toaster } from '#/web/components/ui/sonner.tsx'
import { useAppBootstrap } from '#/web/hooks/useAppBootstrap.ts'
import { useAppOverlays } from '#/web/hooks/useAppOverlays.ts'
import { useBackgroundFetch } from '#/web/hooks/useBackgroundFetch.ts'
import { useNetworkReconnect } from '#/web/hooks/useNetworkReconnect.ts'
import { useRepoStatusRefresh } from '#/web/hooks/useRepoStatusRefresh.ts'
import { useKeyboard } from '#/web/hooks/useKeyboard.ts'
import { useRendererEffectIntentRouter } from '#/web/hooks/useRendererEffectIntentRouter.ts'
import { useRepoDrop } from '#/web/hooks/useRepoDrop.ts'
import { useRepoStoreInvalidationRefresh } from '#/web/hooks/useRepoStoreInvalidationRefresh.ts'
import { useSessionPersistence } from '#/web/hooks/useSessionPersistence.ts'
import { useSettingsWriteErrorToast } from '#/web/hooks/useSettingsWriteErrorToast.ts'
import { useSettingsQueryInvalidationSync } from '#/web/settings-queries.ts'
import { createMainWindowNavigationActions } from '#/web/main-window-navigation-actions.ts'
import { MainWindowNavigationProvider } from '#/web/main-window-navigation.tsx'
import { LayoutOverlayActions } from '#/web/layout-overlay-actions-context.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import {
  mainWindowNavigationStoreActionsEqual,
  mainWindowNavigationStoreActionsFromStore,
} from '#/web/stores/repos/selector-actions.ts'

export function Layout() {
  const navigate = useNavigate()
  const location = useRouterState({ select: (s) => s.location })
  const isSettingsOpen = location.pathname.startsWith('/settings')

  useAppBootstrap()
  useSessionPersistence()
  useSettingsWriteErrorToast()
  useBackgroundFetch()
  useRepoStatusRefresh()
  useNetworkReconnect()

  const overlays = useAppOverlays()
  const modalOpen = overlays.anyOpen

  const activeId = useReposStore((s) => s.activeId)
  const order = useReposStore((s) => s.order)
  const { setActive, closeRepo, cycleActive, selectBranch, setWorkspacePaneView, setCompactWorkspacePane } =
    useStoreWithEqualityFn(
      useReposStore,
      mainWindowNavigationStoreActionsFromStore,
      mainWindowNavigationStoreActionsEqual,
    )
  const navigation = useMemo(
    () =>
      createMainWindowNavigationActions({
        activeId,
        order,
        setActive,
        closeRepo,
        cycleActive,
        selectBranch,
        setWorkspacePaneView,
        setCompactWorkspacePane,
        onOpenSettings: (page) => void navigate({ to: `/settings/${page}` }),
      }),
    [
      activeId,
      closeRepo,
      cycleActive,
      navigate,
      order,
      selectBranch,
      setActive,
      setWorkspacePaneView,
      setCompactWorkspacePane,
    ],
  )

  const workspaceShortcutsSuppressed = modalOpen || isSettingsOpen

  useRendererEffectIntentRouter({
    navigation,
    currentRepoId: activeId,
    closeAllOverlays: overlays.closeAllOverlays,
    openRepoPathDialog: overlays.openRepoPathDialog,
    openCloneRepo: overlays.openCloneRepo,
    openRemoteRepo: overlays.openRemoteRepo,
    isOverlayOpen: () => modalOpen,
    isWorkspaceShortcutSuppressed: () => workspaceShortcutsSuppressed,
  })

  useKeyboard({
    navigation,
    currentRepoId: activeId,
    onShowHelp: () => void navigate({ to: '/settings/shortcuts' }),
    isWorkspaceShortcutSuppressed: () => workspaceShortcutsSuppressed,
    isSettingsOpen: () => isSettingsOpen,
    onExitSettings: () => void navigate({ to: '/workspace' }),
  })

  const repoDrop = useRepoDrop({ blocked: modalOpen })

  return (
    <ErrorBoundary>
      <TokenGate>
        <AuthenticatedSideEffects />
        <MainWindowNavigationProvider value={navigation}>
          <LayoutOverlayActions.Provider
            value={{
              openRepoPathDialog: overlays.openRepoPathDialog,
              openCloneRepo: overlays.openCloneRepo,
              openRemoteRepo: overlays.openRemoteRepo,
            }}
          >
            <TerminalSessionProvider>
              <div
                className="relative flex h-full flex-col"
                onDragEnter={repoDrop.onDragEnter}
                onDragOver={repoDrop.onDragOver}
                onDragLeave={repoDrop.onDragLeave}
                onDrop={repoDrop.onDrop}
              >
                <Outlet />
                <MainWindowOverlays overlays={overlays} repoDrop={repoDrop} />
              </div>
            </TerminalSessionProvider>
          </LayoutOverlayActions.Provider>
        </MainWindowNavigationProvider>
        {import.meta.env.DEV ? <TanStackRouterDevtools /> : null}
      </TokenGate>
    </ErrorBoundary>
  )
}

interface MainWindowOverlaysProps {
  overlays: ReturnType<typeof useAppOverlays>
  repoDrop: ReturnType<typeof useRepoDrop>
}

function MainWindowOverlays({ overlays, repoDrop }: MainWindowOverlaysProps) {
  return (
    <>
      <RepoOpenDialog open={overlays.state.openRepo.open} onOpenChange={overlays.setOpenRepoOpen} />
      <RepoCloneDialog open={overlays.state.clone.open} onOpenChange={overlays.setCloneOpen} />
      <OpenRemoteRepositoryDialog
        open={overlays.state.openRemoteRepo.open}
        onOpenChange={overlays.setOpenRemoteRepoOpen}
      />
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
function AuthenticatedSideEffects(): null {
  useRepoStoreInvalidationRefresh()
  useSettingsQueryInvalidationSync()
  return null
}
