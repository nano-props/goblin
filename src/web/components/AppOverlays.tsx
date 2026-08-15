import { defineComponent } from 'vue'
import type { ParsedWorkspacePaneRoute } from '#/web/app/navigation/route-model.ts'
import { BranchActionDialogHost } from '#/web/components/BranchActionDialogHost.tsx'
import { FiletreeActionDialogHost } from '#/web/components/FiletreeActionDialogHost.tsx'
import { OpenRemoteWorkspaceDialog } from '#/web/components/OpenRemoteWorkspaceDialog.tsx'
import { RepoCloneDialog } from '#/web/components/RepoCloneDialog.tsx'
import { TerminalActionDialogHost } from '#/web/components/TerminalActionDialogHost.tsx'
import { WorkspaceDropOverlay } from '#/web/components/WorkspaceDropOverlay.tsx'
import { WorkspaceOpenDialog } from '#/web/components/WorkspaceOpenDialog.tsx'
import { Toaster } from '#/web/components/ui/sonner.tsx'
import type { AppNavigationActions } from '#/web/app/navigation/actions.ts'
import type { useAppOverlays } from '#/web/hooks/useAppOverlays.ts'
import type { useWorkspaceDrop } from '#/web/hooks/useWorkspaceDrop.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { useT } from '#/web/stores/i18n-vue.ts'

interface AppGlobalOverlaysProps {
  overlays: ReturnType<typeof useAppOverlays>
}

interface WorkspaceContextOverlaysProps {
  workspaceDrop: ReturnType<typeof useWorkspaceDrop>
  navigation: AppNavigationActions
  hydratedRouteWorkspaceId: WorkspaceId | null
  currentWorkspaceRuntimeId: string | null
  currentBranchName: string | null
  currentWorkspacePaneRoute: ParsedWorkspacePaneRoute | null
}

export const AppGlobalOverlays = defineComponent<AppGlobalOverlaysProps>({
  name: 'AppGlobalOverlays',
  props: ['overlays'],

  setup(props) {
    const t = useT()
    return () => (
      <>
        <WorkspaceOpenDialog
          open={props.overlays.state.value.openWorkspace.open}
          onOpenChange={props.overlays.setOpenWorkspaceOpen}
        />
        <RepoCloneDialog open={props.overlays.state.value.clone.open} onOpenChange={props.overlays.setCloneOpen} />
        <OpenRemoteWorkspaceDialog
          open={props.overlays.state.value.openRemoteWorkspace.open}
          onOpenChange={props.overlays.setOpenRemoteWorkspaceOpen}
        />
        <Toaster position="bottom-right" closeButton containerAriaLabel={t('app-chrome.notifications')} />
      </>
    )
  },
})

export const WorkspaceContextOverlays = defineComponent<WorkspaceContextOverlaysProps>({
  name: 'WorkspaceContextOverlays',
  props: [
    'workspaceDrop',
    'navigation',
    'hydratedRouteWorkspaceId',
    'currentWorkspaceRuntimeId',
    'currentBranchName',
    'currentWorkspacePaneRoute',
  ],

  setup(props) {
    return () => (
      <>
        <BranchActionDialogHost
          currentWorkspaceId={props.hydratedRouteWorkspaceId}
          currentBranchName={props.currentBranchName}
        />
        <FiletreeActionDialogHost
          currentWorkspaceId={props.hydratedRouteWorkspaceId}
          currentWorkspaceRuntimeId={props.currentWorkspaceRuntimeId}
        />
        <TerminalActionDialogHost
          currentWorkspaceId={props.hydratedRouteWorkspaceId}
          currentWorkspacePaneRoute={props.currentWorkspacePaneRoute}
          navigation={props.navigation}
        />
        <WorkspaceDropOverlay active={props.workspaceDrop.active.value} />
      </>
    )
  },
})
