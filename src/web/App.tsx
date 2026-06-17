import { useContext } from 'react'
import { Trans } from 'react-i18next'
import { Topbar } from '#/web/components/Topbar.tsx'
import { ErrorBoundary } from '#/web/components/ErrorBoundary.tsx'
import { RepoTabs } from '#/web/components/RepoTabs.tsx'
import { SettingsPageScreen } from '#/web/components/SettingsPageScreen.tsx'
import { RepoView } from '#/web/components/RepoView.tsx'
import { RepoWorkspaceSkeleton } from '#/web/components/Skeleton.tsx'
import { useT } from '#/web/stores/i18n.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { LayoutOverlayActions } from '#/web/layout-overlay-actions-context.ts'
import type { SettingsPage } from '#/shared/settings-pages.ts'

// NOTE: App-level lifecycle hooks (bootstrap, session persistence,
// keyboard, event routing, overlays, file drop) live in the <Layout>
// route in main-router.tsx so they survive settings ⇄ workspace
// round-trips. This file handles rendering only.

interface AppProps {
  routeSettingsPage?: SettingsPage | null
  onRouteSettingsPageChange?: (page: SettingsPage | null) => void
}

export function App({ routeSettingsPage = null, onRouteSettingsPageChange }: AppProps) {
  const overlayActions = useContext(LayoutOverlayActions)!
  const activeId = useReposStore((s) => s.activeId)
  const sessionReady = useReposStore((s) => s.sessionReady)
  const workspaceLayout = useReposStore((s) => s.workspaceLayout)
  const detailCollapsed = useReposStore((s) => s.detailCollapsed)
  const detailFocusMode = useReposStore((s) => s.detailFocusMode)

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
      <Topbar onOpenSettings={() => onRouteSettingsPageChange?.('general')} repoId={activeId}>
        <RepoTabs
          currentRepoId={activeId}
          onOpenRepoPathDialog={overlayActions.openRepoPathDialog}
          onOpenRemote={overlayActions.openRemoteRepo}
          onClone={overlayActions.openCloneRepo}
        />
      </Topbar>
      <main className="flex flex-1 min-h-0 min-w-0">
        <ErrorBoundary resetKey={activeId}>
          {activeId ? (
            <RepoView repoId={activeId} />
          ) : !sessionReady ? (
            <RepoWorkspaceSkeleton
              layout={workspaceLayout}
              detailCollapsed={detailCollapsed}
              detailFocusMode={detailFocusMode}
            />
          ) : (
            <EmptyState />
          )}
        </ErrorBoundary>
      </main>
    </>
  )
}

function EmptyState() {
  const t = useT()
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
