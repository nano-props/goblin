import { EmptyWorkspaceView } from '#/web/components/EmptyWorkspaceView.tsx'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { ErrorBoundary } from '#/web/components/ErrorBoundary.tsx'
import { SettingsPageScreen } from '#/web/components/SettingsPageScreen.tsx'
import { WorkspaceView } from '#/web/components/WorkspaceView.tsx'
import { WorkspaceLayoutSkeleton } from '#/web/components/Skeleton.tsx'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import type { SettingsPage } from '#/shared/settings-pages.ts'
import { workspaceLayoutBehavior } from '#/web/lib/workspace-layout.ts'
import { useResponsiveUiMode } from '#/web/hooks/useResponsiveUiMode.tsx'
import type { WorkspacePaneStaticTabType } from '#/shared/workspace-pane.ts'

// NOTE: App-level lifecycle hooks (bootstrap, session persistence,
// keyboard, event routing, overlays, file drop) live in the <Layout>
// route in primary-window-router.tsx so they survive settings ⇄ workspace
// round-trips. This file handles rendering only.

interface AppProps {
  routeSettingsPage?: SettingsPage | null
  routeWorkspaceView?: WorkspaceRouteView | null
  onRouteSettingsPageChange?: (page: SettingsPage | null) => void
  onOpenWorkspaceNavigator?: (workspaceId: WorkspaceId) => void
  onOpenWorkspaceRootPane?: (workspaceId: WorkspaceId) => void
  onOpenWorkspaceDashboard?: (workspaceId: WorkspaceId) => void
  onOpenRepoBranch?: (workspaceId: WorkspaceId, branchName: string) => void
  onOpenRepoNewWorktree?: (workspaceId: WorkspaceId) => void
  onCancelRepoNewWorktree?: (workspaceId: WorkspaceId) => void
  onReplaceRepoBranch?: (workspaceId: WorkspaceId, branchName: string) => void
}

export type WorkspaceRouteView =
  | { kind: 'empty'; workspaceId: WorkspaceId }
  | { kind: 'workspace-root'; workspaceId: WorkspaceId; workspacePaneRoute: ParsedWorkspacePaneRoute | null }
  | {
      kind: 'worktree'
      workspaceId: WorkspaceId
      worktreePath: string
      workspacePaneRoute: ParsedWorkspacePaneRoute | null
    }
  | { kind: 'dashboard'; workspaceId: WorkspaceId }
  | {
      kind: 'branch'
      workspaceId: WorkspaceId
      branchName: string
      workspacePaneRoute: ParsedWorkspacePaneRoute | null
    }
  | { kind: 'newWorktree'; workspaceId: WorkspaceId }

export type WorkspacePaneRoute =
  { kind: 'static'; tab: WorkspacePaneStaticTabType } | { kind: 'terminal'; terminalSessionId: string }

export type WorkspacePaneRouteTarget = WorkspacePaneRoute | null

export type ParsedWorkspacePaneRoute = WorkspacePaneRoute | { kind: 'invalid-static'; tabKey: string }

export type ParsedWorkspacePaneRouteTarget = ParsedWorkspacePaneRoute | null

export function App({
  routeSettingsPage = null,
  routeWorkspaceView = null,
  onRouteSettingsPageChange,
  onOpenWorkspaceNavigator,
  onOpenWorkspaceRootPane,
  onOpenWorkspaceDashboard,
  onOpenRepoBranch,
  onOpenRepoNewWorktree,
  onCancelRepoNewWorktree,
  onReplaceRepoBranch,
}: AppProps) {
  const workspaceMembershipReady = useWorkspacesStore((s) => s.workspaceMembershipReady)
  const zenMode = useWorkspacesStore((s) => s.zenMode)
  const uiMode = useResponsiveUiMode()
  const bootWorkspaceBehavior = workspaceLayoutBehavior({
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
      <ErrorBoundary resetKey={routeWorkspaceView?.workspaceId ?? 'empty'}>
        {routeWorkspaceView ? (
          <WorkspaceView
            workspaceId={routeWorkspaceView.workspaceId}
            routeView={routeWorkspaceView}
            onOpenSettings={() => onRouteSettingsPageChange?.('general')}
            onOpenWorkspaceNavigator={onOpenWorkspaceNavigator}
            onOpenWorkspaceRootPane={onOpenWorkspaceRootPane}
            onOpenWorkspaceDashboard={onOpenWorkspaceDashboard}
            onOpenRepoBranch={onOpenRepoBranch}
            onOpenRepoNewWorktree={onOpenRepoNewWorktree}
            onCancelRepoNewWorktree={onCancelRepoNewWorktree}
            onReplaceRepoBranch={onReplaceRepoBranch}
          />
        ) : !workspaceMembershipReady ? (
          <WorkspaceLayoutSkeleton
            singlePane={bootWorkspaceBehavior.singlePane}
            singlePaneView="navigator"
            workspacePaneState="empty"
          />
        ) : (
          <EmptyWorkspaceView onOpenSettings={() => onRouteSettingsPageChange?.('general')} />
        )}
      </ErrorBoundary>
    </main>
  )
}
