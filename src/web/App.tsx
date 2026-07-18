import { EmptyRepoView } from '#/web/components/EmptyRepoView.tsx'
import { ErrorBoundary } from '#/web/components/ErrorBoundary.tsx'
import { SettingsPageScreen } from '#/web/components/SettingsPageScreen.tsx'
import { RepoView } from '#/web/components/RepoView.tsx'
import { RepoWorkspaceLayoutSkeleton } from '#/web/components/Skeleton.tsx'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import type { SettingsPage } from '#/shared/settings-pages.ts'
import { repoWorkspaceBehavior } from '#/web/lib/workspace-layout.ts'
import { useResponsiveUiMode } from '#/web/hooks/useResponsiveUiMode.tsx'
import type { WorkspacePaneStaticTabType } from '#/shared/workspace-pane.ts'

// NOTE: App-level lifecycle hooks (bootstrap, session persistence,
// keyboard, event routing, overlays, file drop) live in the <Layout>
// route in primary-window-router.tsx so they survive settings ⇄ workspace
// round-trips. This file handles rendering only.

interface AppProps {
  routeSettingsPage?: SettingsPage | null
  routeRepoView?: RepoRouteView | null
  onRouteSettingsPageChange?: (page: SettingsPage | null) => void
  onOpenRepoRoot?: (repoId: string) => void
  onOpenWorkspaceRoot?: (workspaceId: string) => void
  onOpenRepoDashboard?: (repoId: string) => void
  onOpenRepoBranch?: (repoId: string, branchName: string) => void
  onOpenRepoNewWorktree?: (repoId: string) => void
  onCancelRepoNewWorktree?: (repoId: string) => void
  onReplaceRepoBranch?: (repoId: string, branchName: string) => void
}

export type RepoRouteView =
  | { kind: 'empty'; repoId: string }
  | { kind: 'workspace-root'; repoId: string }
  | {
      kind: 'worktree'
      repoId: string
      worktreePath: string
      workspacePaneRoute: ParsedWorkspacePaneRoute | null
    }
  | { kind: 'dashboard'; repoId: string }
  | {
      kind: 'branch'
      repoId: string
      branchName: string
      workspacePaneRoute: ParsedWorkspacePaneRoute | null
    }
  | { kind: 'newWorktree'; repoId: string }

export type WorkspacePaneRoute =
  { kind: 'static'; tab: WorkspacePaneStaticTabType } | { kind: 'terminal'; terminalSessionId: string }

export type WorkspacePaneRouteTarget = WorkspacePaneRoute | null

export type ParsedWorkspacePaneRoute =
  WorkspacePaneRoute | { kind: 'invalid-static'; tabKey: string }

export type ParsedWorkspacePaneRouteTarget = ParsedWorkspacePaneRoute | null

export function App({
  routeSettingsPage = null,
  routeRepoView = null,
  onRouteSettingsPageChange,
  onOpenRepoRoot,
  onOpenWorkspaceRoot,
  onOpenRepoDashboard,
  onOpenRepoBranch,
  onOpenRepoNewWorktree,
  onCancelRepoNewWorktree,
  onReplaceRepoBranch,
}: AppProps) {
  const workspaceMembershipReady = useWorkspacesStore((s) => s.workspaceMembershipReady)
  const zenMode = useWorkspacesStore((s) => s.zenMode)
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
      <ErrorBoundary resetKey={routeRepoView?.repoId ?? 'empty'}>
        {routeRepoView ? (
          <RepoView
            workspaceId={routeRepoView.repoId}
            routeView={routeRepoView}
            onOpenSettings={() => onRouteSettingsPageChange?.('general')}
            onOpenRepoRoot={onOpenRepoRoot}
            onOpenWorkspaceRoot={onOpenWorkspaceRoot}
            onOpenRepoDashboard={onOpenRepoDashboard}
            onOpenRepoBranch={onOpenRepoBranch}
            onOpenRepoNewWorktree={onOpenRepoNewWorktree}
            onCancelRepoNewWorktree={onCancelRepoNewWorktree}
            onReplaceRepoBranch={onReplaceRepoBranch}
          />
        ) : !workspaceMembershipReady ? (
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
