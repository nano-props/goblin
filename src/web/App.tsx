// Root layout — two-region shell:
//   row 1 (40px): Topbar with embedded RepoTabs strip
//   row 2 (1fr):  active RepoView body
//
// Boots in this order:
//   1. theme.hydrate()       — reads server-backed theme settings
//   2. settings.hydrate()    — persistable settings + saved session
//   3. settings.hydrateExternalApps() — external app snapshot
//   4. repos.hydrateSession  — re-opens the repos that were open last run
//
// After hydration, side-effects run for the lifetime of the app:
//   - background sync registration with the embedded server scheduler
//   - session persistence (any change to open repos / active id writes
//     through to the embedded server so the next launch can restore)
//   - menu-action listener (forwards typed RPC events to store actions)
//   - settings write-error toast (warns the user if prefs aren't
//     persisting instead of silently dropping their changes)

import { useCallback, useMemo } from 'react'
import { Trans } from 'react-i18next'
import { Toaster } from '#/web/components/ui/sonner.tsx'
import { Topbar } from '#/web/components/Topbar.tsx'
import { ErrorBoundary } from '#/web/components/ErrorBoundary.tsx'
import { RepoTabs } from '#/web/components/RepoTabs.tsx'
import { RepoCloneDialog } from '#/web/components/RepoCloneDialog.tsx'
import { RepoOpenDialog } from '#/web/components/RepoOpenDialog.tsx'
import { OpenRemoteRepositoryDialog } from '#/web/components/OpenRemoteRepositoryDialog.tsx'
import { SettingsPageScreen } from '#/web/components/SettingsPageScreen.tsx'
import { RepoView } from '#/web/components/RepoView.tsx'
import { RepoWorkspaceSkeleton } from '#/web/components/Skeleton.tsx'
import { RepoDropOverlay } from '#/web/components/RepoDropOverlay.tsx'
import { TerminalSessionProvider } from '#/web/components/terminal/TerminalSessionProvider.tsx'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { useT } from '#/web/stores/i18n.ts'
import { useKeyboard } from '#/web/hooks/useKeyboard.ts'
import { useRepoDrop } from '#/web/hooks/useRepoDrop.ts'
import { useAppBootstrap } from '#/web/hooks/useAppBootstrap.ts'
import { useBackgroundFetch } from '#/web/hooks/useBackgroundFetch.ts'
import { useExternalOpenPaths } from '#/web/hooks/useExternalOpenPaths.ts'
import { useAppOverlays } from '#/web/hooks/useAppOverlays.ts'
import { useMenuActions } from '#/web/hooks/useMenuActions.ts'
import { useSessionPersistence } from '#/web/hooks/useSessionPersistence.ts'
import { useSettingsWriteErrorToast } from '#/web/hooks/useSettingsWriteErrorToast.ts'
import { useRepoStoreInvalidationRefresh } from '#/web/hooks/useRepoStoreInvalidationRefresh.ts'
import { useRoutedActiveRepo } from '#/web/hooks/useRoutedActiveRepo.ts'
import { useRoutedSelectedBranch } from '#/web/hooks/useRoutedSelectedBranch.ts'
import { useRoutedDetailTab } from '#/web/hooks/useRoutedDetailTab.ts'
import { MainWindowNavigationProvider, type MainWindowNavigationActions } from '#/web/main-window-navigation.tsx'
import { nextRouteRepoIdAfterClose, visibleRepoIdForMainWindow } from '#/web/main-window-navigation-state.ts'
import { repoWorkspaceBehavior } from '#/web/lib/workspace-layout.ts'
import type { AppOverlayKey } from '#/web/hooks/useAppOverlays.ts'
import type { DetailTab } from '#/web/stores/repos/types.ts'
import type { SettingsPage } from '#/shared/settings-pages.ts'

export interface MainWindowRoutePatch {
  repoId?: string | null
  branch?: string | null
  overlay?: AppOverlayKey | null
  detailTab?: DetailTab | null
  settingsPage?: SettingsPage | null
}

interface AppProps {
  routeRepoId?: string | null
  onRouteRepoChange?: (repoId: string | null) => void
  routeOverlay?: AppOverlayKey | null
  onRouteOverlayChange?: (overlay: AppOverlayKey | null) => void
  routeSettingsPage?: SettingsPage | null
  onRouteSettingsPageChange?: (page: SettingsPage | null) => void
  routeBranch?: string | null
  onRouteBranchChange?: (branch: string | null) => void
  routeDetailTab?: DetailTab | null
  onRouteDetailTabChange?: (tab: DetailTab | null) => void
  onRouteChange?: (patch: MainWindowRoutePatch) => void
}

export function App({
  routeRepoId = null,
  onRouteRepoChange,
  routeOverlay = null,
  onRouteOverlayChange,
  routeSettingsPage = null,
  onRouteSettingsPageChange,
  routeBranch = null,
  onRouteBranchChange,
  routeDetailTab = null,
  onRouteDetailTabChange,
  onRouteChange,
}: AppProps) {
  const activeId = useReposStore((s) => s.activeId)
  const repos = useReposStore((s) => s.repos)
  const sessionReady = useReposStore((s) => s.sessionReady)
  const detailCollapsed = useReposStore((s) => s.detailCollapsed)
  const workspaceLayout = useReposStore((s) => s.workspaceLayout)
  const order = useReposStore((s) => s.order)
  const setActive = useReposStore((s) => s.setActive)
  const closeRepo = useReposStore((s) => s.closeRepo)
  const cycleActive = useReposStore((s) => s.cycleActive)
  const selectBranch = useReposStore((s) => s.selectBranch)
  const setDetailTab = useReposStore((s) => s.setDetailTab)
  const overlays = useAppOverlays({ routeOverlay, onRouteOverlayChange })
  const workspaceBehavior = repoWorkspaceBehavior(workspaceLayout, detailCollapsed)
  const visibleRepoId = visibleRepoIdForMainWindow(routeRepoId, activeId, repos)
  const settingsOpen = routeSettingsPage !== null
  const workspaceShortcutsSuppressed = overlays.anyOpen || settingsOpen
  const openSettings = useCallback(
    (page: SettingsPage = 'general') => {
      onRouteSettingsPageChange?.(page)
    },
    [onRouteSettingsPageChange],
  )
  const showHelp = useCallback(() => {
    openSettings('shortcuts')
  }, [openSettings])
  const navigation = useMemo<MainWindowNavigationActions>(
    () => ({
      activateRepo(repoId) {
        if (onRouteChange) {
          onRouteChange({ repoId })
          return
        }
        setActive(repoId)
      },
      closeRepo(repoId) {
        const nextRepoId = nextRouteRepoIdAfterClose(order, visibleRepoId, repoId)
        closeRepo(repoId)
        if (onRouteChange && nextRepoId !== undefined) onRouteChange({ repoId: nextRepoId })
      },
      cycleRepo(direction) {
        if (onRouteChange) {
          if (order.length === 0) return
          const current = visibleRepoId ? order.indexOf(visibleRepoId) : -1
          const nextIndex = current === -1 ? 0 : (current + direction + order.length) % order.length
          const nextRepoId = order[nextIndex]
          if (nextRepoId) onRouteChange({ repoId: nextRepoId })
          return
        }
        cycleActive(direction)
      },
      selectRepoBranch(repoId, branch) {
        if (onRouteChange) {
          onRouteChange({ repoId, branch })
          return
        }
        if (repoId !== activeId) setActive(repoId)
        selectBranch(repoId, branch)
      },
      showRepoDetailTab(repoId, tab) {
        if (onRouteChange) {
          onRouteChange({ repoId, detailTab: tab })
          return
        }
        if (repoId !== activeId) setActive(repoId)
        setDetailTab(repoId, tab)
      },
      showRepoBranchDetailTab(repoId, branch, tab) {
        if (onRouteChange) {
          onRouteChange({ repoId, branch, detailTab: tab })
          return
        }
        if (repoId !== activeId) setActive(repoId)
        selectBranch(repoId, branch)
        setDetailTab(repoId, tab)
      },
      openSettings(page) {
        openSettings(page)
      },
    }),
    [
      activeId,
      closeRepo,
      cycleActive,
      onRouteChange,
      openSettings,
      order,
      selectBranch,
      setActive,
      setDetailTab,
      visibleRepoId,
    ],
  )
  // Shared gate: any modal overlay suppresses both
  // keyboard shortcuts and the file-drop dashed border.
  const modalOpen = overlays.anyOpen
  const repoDrop = useRepoDrop({ blocked: modalOpen })

  useAppBootstrap()
  useSessionPersistence({ routeRepoId })
  useSettingsWriteErrorToast()
  useBackgroundFetch()
  useExternalOpenPaths()
  useRepoStoreInvalidationRefresh()
  useRoutedActiveRepo({ activeId, sessionReady, routeRepoId, onRouteRepoChange })
  useRoutedSelectedBranch({ currentRepoId: visibleRepoId, sessionReady, routeBranch, onRouteBranchChange })
  useRoutedDetailTab({ currentRepoId: visibleRepoId, sessionReady, routeDetailTab, onRouteDetailTabChange })
  useMenuActions({
    navigation,
    currentRepoId: visibleRepoId,
    closeAllOverlays: overlays.closeAllOverlays,
    openRepoPathDialog: overlays.openRepoPathDialog,
    openCloneRepo: overlays.openCloneRepo,
    openRemoteRepo: overlays.openRemoteRepo,
    isOverlayOpen: () => modalOpen,
    isWorkspaceShortcutSuppressed: () => workspaceShortcutsSuppressed,
  })

  useKeyboard({
    navigation,
    currentRepoId: visibleRepoId,
    onShowHelp: showHelp,
    isWorkspaceShortcutSuppressed: () => workspaceShortcutsSuppressed,
    isSettingsOpen: () => settingsOpen,
    onExitSettings: () => onRouteSettingsPageChange?.(null),
  })

  return (
    // Outer ErrorBoundary catches crashes in Topbar/Sidebar — without
    // this, a corrupt settings.json or rendering bug elsewhere blanks
    // the entire window. The inner ErrorBoundary around RepoView still
    // exists so a tab-specific crash doesn't take down the rest of the
    // app.
    <ErrorBoundary>
      <TerminalSessionProvider currentRepoId={visibleRepoId}>
        <MainWindowNavigationProvider value={navigation}>
          <div
            className="relative flex h-full flex-col"
            onDragEnter={repoDrop.onDragEnter}
            onDragOver={repoDrop.onDragOver}
            onDragLeave={repoDrop.onDragLeave}
            onDrop={repoDrop.onDrop}
          >
            {routeSettingsPage ? (
              <SettingsPageScreen
                page={routeSettingsPage}
                onBack={() => onRouteSettingsPageChange?.(null)}
                onPageChange={(page) => onRouteSettingsPageChange?.(page)}
              />
            ) : (
              <>
                <Topbar onOpenSettings={() => openSettings()}>
                  <RepoTabs
                    currentRepoId={visibleRepoId}
                    onOpenRepoPathDialog={overlays.openRepoPathDialog}
                    onOpenRemote={overlays.openRemoteRepo}
                    onClone={overlays.openCloneRepo}
                  />
                </Topbar>
                <main className="flex flex-1 min-h-0 min-w-0">
                  <ErrorBoundary resetKey={visibleRepoId}>
                    {visibleRepoId ? (
                      <RepoView repoId={visibleRepoId} />
                    ) : !sessionReady ? (
                      <RepoWorkspaceSkeleton
                        showRepoToolbar
                        layout={workspaceLayout}
                        detailCollapsed={workspaceBehavior.detailCollapsed}
                      />
                    ) : (
                      <EmptyState />
                    )}
                  </ErrorBoundary>
                </main>
              </>
            )}
            <RepoOpenDialog open={overlays.state.openRepo.open} onOpenChange={overlays.setOpenRepoOpen} />
            <RepoCloneDialog open={overlays.state.clone.open} onOpenChange={overlays.setCloneOpen} />
            <OpenRemoteRepositoryDialog
              open={overlays.state.openRemoteRepo.open}
              onOpenChange={overlays.setOpenRemoteRepoOpen}
            />
            <RepoDropOverlay active={repoDrop.active} />
            {/* shadcn/ui Toaster wrapper — owns its own theme + style hooks.
             * App-level only sets position + closeButton; the rest of the
             * visual contract is in components/ui/sonner.tsx. */}
            <Toaster position="bottom-right" closeButton />
          </div>
        </MainWindowNavigationProvider>
      </TerminalSessionProvider>
    </ErrorBoundary>
  )
}

function EmptyState() {
  const t = useT()
  // Body is rendered as React fragments rather than dangerouslySet
  // because the dictionary text contains a placeholder for "Open" and
  // the highlighted label is easier to express as a real element and
  // removes the only XSS risk vector for this string.
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="text-center max-w-sm">
        <div className="text-sm font-medium text-foreground mb-1">{t('empty.title')}</div>
        <div className="text-xs text-muted-foreground leading-relaxed">
          <Trans i18nKey="empty.body" components={{ open: <span className="text-foreground" /> }} />
        </div>
      </div>
    </div>
  )
}
