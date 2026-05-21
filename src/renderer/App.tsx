// Root layout — three-region shell:
//   row 1 (40px): Topbar (always)
//   row 2 (40px): RepoTabs strip
//   row 3 (1fr):  active RepoView body
//
// Boots in this order:
//   1. theme.hydrate()       — pulls main's resolved theme + subscribes
//   2. settings.hydrate()    — fetch interval + saved session
//   3. repos.hydrateSession  — re-opens the repos that were open last run
//
// After hydration, side-effects run for the lifetime of the app:
//   - background fetch loop (active repo only, debounced by interval)
//   - session persistence (any change to open repos / active id writes
//     through to main so the next launch can restore)
//   - menu-action listener (forwards `app:menu-invoke` to store actions)
//   - settings write-error toast (warns the user if prefs aren't
//     persisting instead of silently dropping their changes)

import { useCallback, useEffect, useState } from 'react'
import { Toaster } from '#/renderer/components/ui/sonner.tsx'
import { Topbar } from '#/renderer/components/Topbar.tsx'
import { ErrorBoundary } from '#/renderer/components/ErrorBoundary.tsx'
import { RepoTabs } from '#/renderer/components/RepoTabs.tsx'
import { RepoView } from '#/renderer/components/RepoView.tsx'
import { RepoWorkspaceSkeleton } from '#/renderer/components/Skeleton.tsx'
import { SettingsPanel } from '#/renderer/components/SettingsPanel.tsx'
import { HelpOverlay } from '#/renderer/components/HelpOverlay.tsx'
import { DependenciesOverlay } from '#/renderer/components/DependenciesOverlay.tsx'
import { RepoDropOverlay } from '#/renderer/components/RepoDropOverlay.tsx'
import { useReposStore } from '#/renderer/stores/repos.ts'
import { useSettingsStore } from '#/renderer/stores/settings.ts'
import { useT } from '#/renderer/stores/i18n.ts'
import { useKeyboard } from '#/renderer/hooks/useKeyboard.ts'
import { useRepoDrop } from '#/renderer/hooks/useRepoDrop.ts'
import { useAppBootstrap } from '#/renderer/hooks/useAppBootstrap.ts'
import { useBackgroundFetch } from '#/renderer/hooks/useBackgroundFetch.ts'
import { useMenuActions } from '#/renderer/hooks/useMenuActions.ts'
import { useSessionPersistence } from '#/renderer/hooks/useSessionPersistence.ts'
import { useSettingsWriteErrorToast } from '#/renderer/hooks/useSettingsWriteErrorToast.ts'

export function App() {
  const activeId = useReposStore((s) => s.activeId)
  const sessionReady = useReposStore((s) => s.sessionReady)
  const detailCollapsed = useReposStore((s) => s.detailCollapsed)
  const shortcutsDisabled = useSettingsStore((s) => s.shortcutsDisabled)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [dependenciesOpen, setDependenciesOpen] = useState(false)
  const openSettings = useCallback(() => setSettingsOpen(true), [])
  const showHelp = useCallback(() => {
    if (!shortcutsDisabled) setHelpOpen(true)
  }, [shortcutsDisabled])
  const showDependencies = useCallback(() => setDependenciesOpen(true), [])
  // Shared gate: any modal overlay (Settings, Help) suppresses both
  // keyboard shortcuts and the file-drop dashed border. useKeyboard
  // additionally OR's in commit-detail, which is per-repo state read
  // from the store inside the hook itself.
  const modalOpen = settingsOpen || helpOpen || dependenciesOpen
  const repoDrop = useRepoDrop({ blocked: modalOpen })

  useEffect(() => {
    if (shortcutsDisabled) setHelpOpen(false)
  }, [shortcutsDisabled])

  useAppBootstrap()
  useSessionPersistence()
  useSettingsWriteErrorToast()
  useBackgroundFetch()
  useMenuActions({ openSettings, showHelp })

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
      <div
        className="relative flex h-full flex-col"
        onDragEnter={repoDrop.onDragEnter}
        onDragOver={repoDrop.onDragOver}
        onDragLeave={repoDrop.onDragLeave}
        onDrop={repoDrop.onDrop}
      >
        <Topbar onOpenSettings={openSettings} onShowDependencies={showDependencies} onShowHelp={showHelp} />
        <RepoTabs />
        <main className="flex flex-1 min-h-0 min-w-0">
          <ErrorBoundary resetKey={activeId}>
            {!sessionReady ? (
              <RepoWorkspaceSkeleton showRepoToolbar detailCollapsed={detailCollapsed} />
            ) : activeId ? (
              <RepoView repoId={activeId} />
            ) : (
              <EmptyState />
            )}
          </ErrorBoundary>
        </main>
        <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
        <DependenciesOverlay open={dependenciesOpen} onClose={() => setDependenciesOpen(false)} />
        <HelpOverlay open={helpOpen} onClose={() => setHelpOpen(false)} />
        {repoDrop.active && <RepoDropOverlay />}
        {/* shadcn/ui Toaster wrapper — owns its own theme + style hooks.
         * App-level only sets position + closeButton; the rest of the
         * visual contract is in components/ui/sonner.tsx. */}
        <Toaster position="bottom-right" closeButton />
      </div>
    </ErrorBoundary>
  )
}

function EmptyState() {
  const t = useT()
  const shortcutsDisabled = useSettingsStore((s) => s.shortcutsDisabled)
  // Body is rendered as React fragments rather than dangerouslySet
  // because the dictionary text contains a placeholder for "Open" and
  // a kbd chip — both of which are easier to express as real elements
  // and remove the only XSS risk vector for this string.
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="text-center max-w-sm">
        <div className="text-sm font-medium text-foreground mb-1">{t('empty.title')}</div>
        <div className="text-xs text-muted-foreground leading-relaxed">
          {t('empty.body.before')}
          <span className="text-foreground">{t('empty.body.open-label')}</span>
          {shortcutsDisabled ? (
            t('empty.body.after-shortcuts-disabled')
          ) : (
            <>
              {t('empty.body.middle')}
              <span className="kbd">?</span>
              {t('empty.body.after')}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
