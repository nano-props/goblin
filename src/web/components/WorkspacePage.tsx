import { defineComponent } from 'vue'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { AppNavigationGeneration } from '#/web/app/navigation/lifecycle.ts'
import type { WorkspaceRouteView } from '#/web/app/navigation/route-model.ts'
import { EmptyWorkspaceView } from '#/web/components/EmptyWorkspaceView.tsx'
import { ErrorBoundary } from '#/web/components/ErrorBoundary.tsx'
import { WorkspaceLayoutSkeleton } from '#/web/components/Skeleton.tsx'
import { WorkspaceView } from '#/web/components/WorkspaceView.tsx'
import { useResponsiveUiMode } from '#/web/hooks/useResponsiveUiMode.tsx'
import { workspaceLayoutBehavior } from '#/web/lib/workspace-layout.ts'
import { useStoreSelector } from '#/web/stores/store-selector.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'

export interface WorkspacePageProps {
  routeWorkspaceView?: WorkspaceRouteView | null
  onOpenSettings?: () => void
  onOpenWorkspaceNavigator?: (workspaceId: WorkspaceId) => void
  onOpenWorkspaceRootPane?: (workspaceId: WorkspaceId) => void
  onOpenWorkspaceDashboard?: (workspaceId: WorkspaceId) => void
  onOpenRepoNewWorktree?: (workspaceId: WorkspaceId) => void
  onCancelRepoNewWorktree?: (workspaceId: WorkspaceId) => void
  onReplaceRepoWorktree?: (
    workspaceId: WorkspaceId,
    worktreePath: string,
    navigationGeneration: AppNavigationGeneration,
  ) => void
}

export const WorkspacePage = defineComponent<WorkspacePageProps>({
  name: 'WorkspacePage',
  props: [
    'routeWorkspaceView',
    'onOpenSettings',
    'onOpenWorkspaceNavigator',
    'onOpenWorkspaceRootPane',
    'onOpenWorkspaceDashboard',
    'onOpenRepoNewWorktree',
    'onCancelRepoNewWorktree',
    'onReplaceRepoWorktree',
  ],

  setup(props) {
    const workspaceMembershipReady = useStoreSelector(workspacesStore, (state) => state.workspaceMembershipReady)
    const zenMode = useStoreSelector(workspacesStore, (state) => state.zenMode)
    const uiMode = useResponsiveUiMode()

    return () => {
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
                onOpenSettings={props.onOpenSettings}
                onOpenWorkspaceNavigator={props.onOpenWorkspaceNavigator}
                onOpenWorkspaceRootPane={props.onOpenWorkspaceRootPane}
                onOpenWorkspaceDashboard={props.onOpenWorkspaceDashboard}
                onOpenRepoNewWorktree={props.onOpenRepoNewWorktree}
                onCancelRepoNewWorktree={props.onCancelRepoNewWorktree}
                onReplaceRepoWorktree={props.onReplaceRepoWorktree}
              />
            ) : !workspaceMembershipReady.value ? (
              <WorkspaceLayoutSkeleton
                singlePane={bootWorkspaceBehavior.singlePane}
                singlePaneView="navigator"
                workspacePaneState="empty"
              />
            ) : (
              <EmptyWorkspaceView onOpenSettings={props.onOpenSettings} />
            )}
          </ErrorBoundary>
        </main>
      )
    }
  },
})
