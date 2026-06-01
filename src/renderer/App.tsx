// Root layout — two-region shell:
//   row 1 (40px): Topbar with embedded RepoTabs strip
//   row 2 (1fr):  active RepoView body
//
// Boots in this order:
//   1. theme.hydrate()       — pulls main's resolved theme + subscribes
//   2. settings.hydrate()    — persistable settings + saved session
//   3. settings.hydrateExternalApps() — external app snapshot
//   4. repos.hydrateSession  — re-opens the repos that were open last run
//
// After hydration, side-effects run for the lifetime of the app:
//   - background fetch loop (active repo only, debounced by interval)
//   - session persistence (any change to open repos / active id writes
//     through to main so the next launch can restore)
//   - menu-action listener (forwards typed RPC events to store actions)
//   - settings write-error toast (warns the user if prefs aren't
//     persisting instead of silently dropping their changes)

import { useCallback } from 'react'
import { Trans } from 'react-i18next'
import { Toaster } from '#/renderer/components/ui/sonner.tsx'
import { Topbar } from '#/renderer/components/Topbar.tsx'
import { ErrorBoundary } from '#/renderer/components/ErrorBoundary.tsx'
import { RepoTabs } from '#/renderer/components/RepoTabs.tsx'
import { RepoCloneDialog } from '#/renderer/components/RepoCloneDialog.tsx'
import { RepoOpenDialog } from '#/renderer/components/RepoOpenDialog.tsx'
import { OpenRemoteRepositoryDialog } from '#/renderer/components/OpenRemoteRepositoryDialog.tsx'
import { RepoView } from '#/renderer/components/RepoView.tsx'
import { RepoWorkspaceSkeleton } from '#/renderer/components/Skeleton.tsx'
import { RepoDropOverlay } from '#/renderer/components/RepoDropOverlay.tsx'
import { TerminalSessionProvider } from '#/renderer/components/terminal/TerminalSessionProvider.tsx'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import { useT } from '#/renderer/stores/i18n.ts'
import { useKeyboard } from '#/renderer/hooks/useKeyboard.ts'
import { useRepoDrop } from '#/renderer/hooks/useRepoDrop.ts'
import { useAppBootstrap } from '#/renderer/hooks/useAppBootstrap.ts'
import { useBackgroundFetch } from '#/renderer/hooks/useBackgroundFetch.ts'
import { useExternalOpenPaths } from '#/renderer/hooks/useExternalOpenPaths.ts'
import { useAppOverlays } from '#/renderer/hooks/useAppOverlays.ts'
import { useMenuActions } from '#/renderer/hooks/useMenuActions.ts'
import { useSessionPersistence } from '#/renderer/hooks/useSessionPersistence.ts'
import { useSettingsWriteErrorToast } from '#/renderer/hooks/useSettingsWriteErrorToast.ts'
import { repoWorkspaceBehavior } from '#/renderer/lib/workspace-layout.ts'
import { rpc } from '#/renderer/rpc.ts'
import type { SettingsPage } from '#/shared/rpc.ts'

export function App() {
  const activeId = useReposStore((s) => s.activeId)
  const sessionReady = useReposStore((s) => s.sessionReady)
  const detailCollapsed = useReposStore((s) => s.detailCollapsed)
  const workspaceLayout = useReposStore((s) => s.workspaceLayout)
  const overlays = useAppOverlays()
  const workspaceBehavior = repoWorkspaceBehavior(workspaceLayout, detailCollapsed)
  const openSettingsWindow = useCallback((page: SettingsPage = 'general') => {
    void rpc.app.openSettingsWindow.mutate({ page }).catch((err) => {
      console.warn('[settings-window] failed to open', err)
    })
  }, [])
  const showHelp = useCallback(() => {
    openSettingsWindow('shortcuts')
  }, [openSettingsWindow])
  // Shared gate: any modal overlay suppresses both
  // keyboard shortcuts and the file-drop dashed border. useKeyboard
  // additionally OR's in commit-detail, which is per-repo state read
  // from the store inside the hook itself.
  const modalOpen = overlays.anyOpen
  const repoDrop = useRepoDrop({ blocked: modalOpen })

  useAppBootstrap()
  useSessionPersistence()
  useSettingsWriteErrorToast()
  useBackgroundFetch()
  useExternalOpenPaths()
  useMenuActions({
    closeAllOverlays: overlays.closeAllOverlays,
    openRepoPathDialog: overlays.openRepoPathDialog,
    openCloneRepo: overlays.openCloneRepo,
    openRemoteRepo: overlays.openRemoteRepo,
    isOverlayOpen: () => modalOpen,
  })

  useKeyboard({
    onShowHelp: showHelp,
    // Inline closure is fine — useKeyboard reads it through a ref on
    // every render, so memoization wouldn't change anything.
    isOverlayOpen: () => modalOpen,
  })

  return (
    // Outer ErrorBoundary catches crashes in Topbar/Sidebar — without
    // this, a corrupt settings.json or rendering bug elsewhere blanks
    // the entire window. The inner ErrorBoundary around RepoView still
    // exists so a tab-specific crash doesn't take down the rest of the
    // app.
    <ErrorBoundary>
      <TerminalSessionProvider>
        <div
          className="relative flex h-full flex-col"
          onDragEnter={repoDrop.onDragEnter}
          onDragOver={repoDrop.onDragOver}
          onDragLeave={repoDrop.onDragLeave}
          onDrop={repoDrop.onDrop}
        >
          <Topbar onOpenSettings={() => openSettingsWindow()}>
            <RepoTabs onOpenRemote={overlays.openRemoteRepo} onClone={overlays.openCloneRepo} />
          </Topbar>
          <main className="flex flex-1 min-h-0 min-w-0">
            <ErrorBoundary resetKey={activeId}>
              {activeId ? (
                <RepoView repoId={activeId} />
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
