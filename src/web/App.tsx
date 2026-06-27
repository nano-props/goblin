import { EmptyRepoView } from '#/web/components/EmptyRepoView.tsx'
import { ErrorBoundary } from '#/web/components/ErrorBoundary.tsx'
import { SettingsPageScreen } from '#/web/components/SettingsPageScreen.tsx'
import { RepoView } from '#/web/components/RepoView.tsx'
import { RepoWorkspaceLayoutSkeleton } from '#/web/components/Skeleton.tsx'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { SettingsPage } from '#/shared/settings-pages.ts'
import { repoWorkspaceBehavior } from '#/web/lib/workspace-layout.ts'
import { useResponsiveUiMode } from '#/web/hooks/useResponsiveUiMode.tsx'

// NOTE: App-level lifecycle hooks (bootstrap, session persistence,
// keyboard, event routing, overlays, file drop) live in the <Layout>
// route in primary-window-router.tsx so they survive settings ⇄ workspace
// round-trips. This file handles rendering only.

interface AppProps {
  routeSettingsPage?: SettingsPage | null
  onRouteSettingsPageChange?: (page: SettingsPage | null) => void
}

export function App({ routeSettingsPage = null, onRouteSettingsPageChange }: AppProps) {
  const activeId = useReposStore((s) => s.activeId)
  const sessionReady = useReposStore((s) => s.sessionReady)
  const zenMode = useReposStore((s) => s.zenMode)
  const uiMode = useResponsiveUiMode()
  const bootWorkspaceBehavior = repoWorkspaceBehavior({
    compact: uiMode === 'compact',
    zenMode,
  })

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
    <main className="flex flex-1 min-h-0 min-w-0">
      <ErrorBoundary resetKey={activeId}>
        {activeId ? (
          <RepoView repoId={activeId} onOpenSettings={() => onRouteSettingsPageChange?.('general')} />
        ) : !sessionReady ? (
          <RepoWorkspaceLayoutSkeleton
            singlePane={bootWorkspaceBehavior.singlePane}
            singlePaneView="navigator"
            repoWorkspaceState="empty"
          />
        ) : (
          <EmptyRepoView onOpenSettings={() => onRouteSettingsPageChange?.('general')} />
        )}
      </ErrorBoundary>
    </main>
  )
}
