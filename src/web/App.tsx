import { defineComponent } from 'vue'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { SettingsPage } from '#/shared/settings-pages.ts'
import type { WorkspacePaneStaticTabType } from '#/shared/workspace-pane.ts'
import type { AppNavigationGeneration } from '#/web/app-navigation-lifecycle.ts'
import { EmptyWorkspaceView } from '#/web/components/EmptyWorkspaceView.tsx'
import { ErrorBoundary } from '#/web/components/ErrorBoundary.tsx'
import { SettingsPageScreen } from '#/web/components/SettingsPageScreen.tsx'
import { WorkspaceLayoutSkeleton } from '#/web/components/Skeleton.tsx'
import { WorkspaceView } from '#/web/components/WorkspaceView.tsx'
import { useResponsiveUiMode } from '#/web/hooks/useResponsiveUiMode.tsx'
import { workspaceLayoutBehavior } from '#/web/lib/workspace-layout.ts'
import { useStoreSelector } from '#/web/stores/store-selector.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'

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

export interface AppProps {
  routeSettingsPage?: SettingsPage | null
  routeWorkspaceView?: WorkspaceRouteView | null
  onRouteSettingsPageChange?: (page: SettingsPage | null) => void
  onOpenWorkspaceNavigator?: (workspaceId: WorkspaceId) => void
  onOpenWorkspaceRootPane?: (workspaceId: WorkspaceId) => void
  onOpenWorkspaceDashboard?: (workspaceId: WorkspaceId) => void
  onOpenRepoBranch?: (workspaceId: WorkspaceId, branchName: string) => void
  onOpenRepoNewWorktree?: (workspaceId: WorkspaceId) => void
  onCancelRepoNewWorktree?: (workspaceId: WorkspaceId) => void
  onReplaceRepoBranch?: (
    workspaceId: WorkspaceId,
    branchName: string,
    navigationGeneration: AppNavigationGeneration,
  ) => void
}

export const App = defineComponent<AppProps>({
  name: 'App',
  props: [
    'routeSettingsPage',
    'routeWorkspaceView',
    'onRouteSettingsPageChange',
    'onOpenWorkspaceNavigator',
    'onOpenWorkspaceRootPane',
    'onOpenWorkspaceDashboard',
    'onOpenRepoBranch',
    'onOpenRepoNewWorktree',
    'onCancelRepoNewWorktree',
    'onReplaceRepoBranch',
  ],

  setup(props) {
    const workspaceMembershipReady = useStoreSelector(workspacesStore, (state) => state.workspaceMembershipReady)
    const zenMode = useStoreSelector(workspacesStore, (state) => state.zenMode)
    const uiMode = useResponsiveUiMode()

    return () => {
      const settingsPage = props.routeSettingsPage ?? null
      if (settingsPage) {
        return (
          <SettingsPageScreen
            page={settingsPage}
            onBack={() => props.onRouteSettingsPageChange?.(null)}
            onPageChange={(page) => props.onRouteSettingsPageChange?.(page)}
          />
        )
      }

      const routeWorkspaceView = props.routeWorkspaceView ?? null
      const bootWorkspaceBehavior = workspaceLayoutBehavior({
        compact: uiMode.value === 'compact',
        zenMode: zenMode.value,
      })
      return (
        <main class="flex min-h-0 min-w-0 flex-1">
          <ErrorBoundary resetKey={routeWorkspaceView?.workspaceId ?? 'empty'}>
            {routeWorkspaceView ? (
              <WorkspaceView
                workspaceId={routeWorkspaceView.workspaceId}
                routeView={routeWorkspaceView}
                onOpenSettings={() => props.onRouteSettingsPageChange?.('general')}
                onOpenWorkspaceNavigator={props.onOpenWorkspaceNavigator}
                onOpenWorkspaceRootPane={props.onOpenWorkspaceRootPane}
                onOpenWorkspaceDashboard={props.onOpenWorkspaceDashboard}
                onOpenRepoBranch={props.onOpenRepoBranch}
                onOpenRepoNewWorktree={props.onOpenRepoNewWorktree}
                onCancelRepoNewWorktree={props.onCancelRepoNewWorktree}
                onReplaceRepoBranch={props.onReplaceRepoBranch}
              />
            ) : !workspaceMembershipReady.value ? (
              <WorkspaceLayoutSkeleton
                singlePane={bootWorkspaceBehavior.singlePane}
                singlePaneView="navigator"
                workspacePaneState="empty"
              />
            ) : (
              <EmptyWorkspaceView onOpenSettings={() => props.onRouteSettingsPageChange?.('general')} />
            )}
          </ErrorBoundary>
        </main>
      )
    }
  },
})
