import { defineComponent } from 'vue'
import { useRoute } from 'vue-router'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { AppNavigationGeneration } from '#/web/app/navigation/lifecycle.ts'
import { useAppRouteAdmission } from '#/web/app/navigation/route-admission.ts'
import { workspaceRouteViewFromRoute } from '#/web/app/navigation/route-model.ts'
import { useAppRouteNavigation } from '#/web/app/navigation/route-navigation.ts'
import type { AppRouteNavigation } from '#/web/app/navigation/route-navigation.ts'
import { WorkspacePage } from '#/web/components/WorkspacePage.tsx'

export const WorkspaceRouteView = defineComponent({
  name: 'WorkspaceRouteView',
  setup() {
    const route = useRoute()
    const routeAdmitted = useAppRouteAdmission(route)
    const callbacks = workspaceRouterCallbacks(useAppRouteNavigation())
    return () => (
      <WorkspacePage
        routeWorkspaceView={routeAdmitted.value ? workspaceRouteViewFromRoute(route) : null}
        {...callbacks}
      />
    )
  },
})

export function workspaceRouterCallbacks(routeActions: AppRouteNavigation) {
  return {
    onOpenSettings: () => routeActions.openSettings('general'),
    onOpenWorkspaceNavigator: (workspaceId: WorkspaceId) => routeActions.openWorkspaceNavigator(workspaceId),
    onOpenWorkspaceRootPane: (workspaceId: WorkspaceId) => routeActions.openWorkspaceRootPane(workspaceId),
    onOpenWorkspaceDashboard: (workspaceId: WorkspaceId) => routeActions.openWorkspaceDashboard(workspaceId),
    onOpenRepoNewWorktree: (workspaceId: WorkspaceId) => routeActions.openRepoNewWorktree(workspaceId),
    onCancelRepoNewWorktree: (workspaceId: WorkspaceId) => routeActions.cancelRepoNewWorktree(workspaceId),
    onReplaceRepoWorktree: (
      workspaceId: WorkspaceId,
      worktreePath: string,
      navigationGeneration: AppNavigationGeneration,
    ) => routeActions.openRepoWorktree(workspaceId, worktreePath, { replace: true, navigationGeneration }),
  }
}
