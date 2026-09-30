import { defineComponent } from 'vue'
import { useRoute } from 'vue-router'
import { useAppRouteAdmission } from '#/web/app/navigation/route-admission.ts'
import { useAppRouteNavigation } from '#/web/app/navigation/route-navigation.ts'
import { EmptyWorkspaceView } from '#/web/components/EmptyWorkspaceView.tsx'
import { WorkspaceLayoutSkeleton } from '#/web/components/Skeleton.tsx'
import { useResponsiveUiMode } from '#/web/hooks/useResponsiveUiMode.tsx'
import { workspaceLayoutBehavior } from '#/web/lib/workspace-layout.ts'
import { useStoreSelector } from '#/web/stores/store-selector.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'

export const HomeRouteView = defineComponent({
  name: 'HomeRouteView',
  setup() {
    useAppRouteAdmission(useRoute())
    const navigation = useAppRouteNavigation()
    const workspaceMembershipReady = useStoreSelector(workspacesStore, (state) => state.workspaceMembershipReady)
    const zenMode = useStoreSelector(workspacesStore, (state) => state.zenMode)
    const uiMode = useResponsiveUiMode()
    return () => {
      const behavior = workspaceLayoutBehavior({ compact: uiMode.value === 'compact', zenMode: zenMode.value })
      return (
        <main class="flex min-h-0 min-w-0 flex-1">
          {workspaceMembershipReady.value ? (
            <EmptyWorkspaceView onOpenSettings={() => navigation.openSettings('general')} />
          ) : (
            <WorkspaceLayoutSkeleton
              singlePane={behavior.singlePane}
              singlePaneView="navigator"
              workspacePaneState="empty"
            />
          )}
        </main>
      )
    }
  },
})
