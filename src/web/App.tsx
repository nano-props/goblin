// Root layout — two-region shell:
//   row 1 (40px): Topbar with embedded RepoTabs strip
//   row 2 (1fr):  active RepoView body
//
// Boots in this order:
//   1. theme.hydrate()       — reads server-backed theme settings
//   2. settings.hydrate()    — saved session bootstrap snapshot
//   3. repos.hydrateSession  — re-opens the repos that were open last run
//
// After hydration, side-effects run for the lifetime of the app:
//   - background sync registration with the embedded server scheduler
//   - session persistence (any change to open repos / active id writes
//     through to the embedded server so the next launch can restore)
//   - renderer effect-intent listeners (menu actions / native attention events)
//   - settings write-error toast (warns the user if prefs aren't
//     persisting instead of silently dropping their changes)

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
import { useT } from '#/web/stores/i18n.ts'
import { useKeyboard } from '#/web/hooks/useKeyboard.ts'
import { useMainWindowShellState } from '#/web/hooks/useMainWindowShellState.ts'
import { useRepoDrop } from '#/web/hooks/useRepoDrop.ts'
import { useAppBootstrap } from '#/web/hooks/useAppBootstrap.ts'
import { useBackgroundFetch } from '#/web/hooks/useBackgroundFetch.ts'
import { useHeuristicRepoStatusRefresh } from '#/web/hooks/useHeuristicRepoStatusRefresh.ts'
import { useRendererEffectIntentRouter } from '#/web/hooks/useRendererEffectIntentRouter.ts'
import { useSessionPersistence } from '#/web/hooks/useSessionPersistence.ts'
import { useSettingsWriteErrorToast } from '#/web/hooks/useSettingsWriteErrorToast.ts'
import { useRepoStoreInvalidationRefresh } from '#/web/hooks/useRepoStoreInvalidationRefresh.ts'
import { useSettingsQueryInvalidationSync } from '#/web/settings-queries.ts'
import { MainWindowNavigationProvider } from '#/web/main-window-navigation.tsx'
import { useResponsiveUiMode } from '#/web/hooks/useResponsiveUiMode.tsx'
import type { SettingsPage } from '#/shared/settings-pages.ts'

interface AppProps {
  routeSettingsPage?: SettingsPage | null
  onRouteSettingsPageChange?: (page: SettingsPage | null) => void
}

export function App({
  routeSettingsPage = null,
  onRouteSettingsPageChange,
}: AppProps) {
  const {
    overlays,
    sessionReady,
    visibleRepoId,
    workspaceLayout,
    workspaceBehavior,
    settingsOpen,
    modalOpen,
    workspaceShortcutsSuppressed,
    openSettings,
    showHelp,
    exitSettings,
    navigation,
  } = useMainWindowShellState({
    routeSettingsPage,
    onRouteSettingsPageChange,
  })
  // Shared gate: any modal overlay suppresses both
  // keyboard shortcuts and the file-drop dashed border.
  const repoDrop = useRepoDrop({ blocked: modalOpen })

  useAppBootstrap()
  useSessionPersistence()
  useSettingsWriteErrorToast()
  useBackgroundFetch()
  useHeuristicRepoStatusRefresh()
  useRepoStoreInvalidationRefresh()
  useSettingsQueryInvalidationSync()
  useRendererEffectIntentRouter({
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
    onExitSettings: exitSettings,
  })

  return (
    <ErrorBoundary>
      <TerminalSessionProvider currentRepoId={visibleRepoId}>
        <MainWindowNavigationProvider value={navigation}>
          <MainWindowViewport
            routeSettingsPage={routeSettingsPage}
            onRouteSettingsPageChange={onRouteSettingsPageChange}
            openSettings={openSettings}
            visibleRepoId={visibleRepoId}
            sessionReady={sessionReady}
            workspaceLayout={workspaceLayout}
            detailCollapsed={workspaceBehavior.detailCollapsed}
            detailFocusMode={workspaceBehavior.detailFocusMode}
            overlays={overlays}
            repoDrop={repoDrop}
          />
        </MainWindowNavigationProvider>
      </TerminalSessionProvider>
    </ErrorBoundary>
  )
}

interface MainWindowViewportProps {
  routeSettingsPage: SettingsPage | null
  onRouteSettingsPageChange?: (page: SettingsPage | null) => void
  openSettings: (page?: SettingsPage) => void
  visibleRepoId: string | null
  sessionReady: boolean
  workspaceLayout: 'top-bottom' | 'left-right'
  detailCollapsed: boolean
  detailFocusMode: boolean
  overlays: ReturnType<typeof useMainWindowShellState>['overlays']
  repoDrop: ReturnType<typeof useRepoDrop>
}

interface MainWindowViewportContentProps {
  routeSettingsPage: SettingsPage | null
  onRouteSettingsPageChange?: (page: SettingsPage | null) => void
  openSettings: (page?: SettingsPage) => void
  visibleRepoId: string | null
  sessionReady: boolean
  workspaceLayout: 'top-bottom' | 'left-right'
  detailCollapsed: boolean
  detailFocusMode: boolean
  overlays: ReturnType<typeof useMainWindowShellState>['overlays']
}

interface MainWindowOverlaysProps {
  overlays: ReturnType<typeof useMainWindowShellState>['overlays']
  repoDrop: ReturnType<typeof useRepoDrop>
}

function MainWindowViewport({
  routeSettingsPage,
  onRouteSettingsPageChange,
  openSettings,
  visibleRepoId,
  sessionReady,
  workspaceLayout,
  detailCollapsed,
  detailFocusMode,
  overlays,
  repoDrop,
}: MainWindowViewportProps) {
  return (
    // Outer ErrorBoundary catches crashes in Topbar/Sidebar — without
    // this, a corrupt settings.json or rendering bug elsewhere blanks
    // the entire window. The inner ErrorBoundary around RepoView still
    // exists so a tab-specific crash doesn't take down the rest of the
    // app.
    <div
      className="relative flex h-full flex-col"
      onDragEnter={repoDrop.onDragEnter}
      onDragOver={repoDrop.onDragOver}
      onDragLeave={repoDrop.onDragLeave}
      onDrop={repoDrop.onDrop}
    >
      <MainWindowViewportContent
        routeSettingsPage={routeSettingsPage}
        onRouteSettingsPageChange={onRouteSettingsPageChange}
        openSettings={openSettings}
        visibleRepoId={visibleRepoId}
        sessionReady={sessionReady}
        workspaceLayout={workspaceLayout}
        detailCollapsed={detailCollapsed}
        detailFocusMode={detailFocusMode}
        overlays={overlays}
      />
      <MainWindowOverlays overlays={overlays} repoDrop={repoDrop} />
    </div>
  )
}

function MainWindowViewportContent({
  routeSettingsPage,
  onRouteSettingsPageChange,
  openSettings,
  visibleRepoId,
  sessionReady,
  workspaceLayout,
  detailCollapsed,
  detailFocusMode,
  overlays,
}: MainWindowViewportContentProps) {
  const uiMode = useResponsiveUiMode()
  if (routeSettingsPage) {
    return (
      <SettingsPageScreen
        page={routeSettingsPage}
        onBack={() => onRouteSettingsPageChange?.(null)}
        onPageChange={(page) => onRouteSettingsPageChange?.(page)}
      />
    )
  }
  return (
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
              detailCollapsed={detailCollapsed}
              detailFocusMode={detailFocusMode}
              compact={uiMode === 'compact'}
            />
          ) : (
            <EmptyState />
          )}
        </ErrorBoundary>
      </main>
    </>
  )
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
      {/* shadcn/ui Toaster wrapper — owns its own theme + style hooks.
       * App-level only sets position + closeButton; the rest of the
       * visual contract is in components/ui/sonner.tsx. */}
      <Toaster position="bottom-right" closeButton />
    </>
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
