import type { ParsedWorkspacePaneRoute } from '#/web/App.tsx'
import { BranchActionDialogHost } from '#/web/components/BranchActionDialogHost.tsx'
import { FiletreeActionDialogHost } from '#/web/components/FiletreeActionDialogHost.tsx'
import { OpenRemoteWorkspaceDialog } from '#/web/components/OpenRemoteWorkspaceDialog.tsx'
import { RepoCloneDialog } from '#/web/components/RepoCloneDialog.tsx'
import { TerminalActionDialogHost } from '#/web/components/TerminalActionDialogHost.tsx'
import { WorkspaceDropOverlay } from '#/web/components/WorkspaceDropOverlay.tsx'
import { WorkspaceOpenDialog } from '#/web/components/WorkspaceOpenDialog.tsx'
import { Toaster } from '#/web/components/ui/sonner.tsx'
import type { AppNavigationActions } from '#/web/app-navigation.tsx'
import type { useAppOverlays } from '#/web/hooks/useAppOverlays.ts'
import type { useWorkspaceDrop } from '#/web/hooks/useWorkspaceDrop.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

interface AppOverlaysProps {
  overlays: ReturnType<typeof useAppOverlays>
  workspaceDrop: ReturnType<typeof useWorkspaceDrop>
  navigation: AppNavigationActions
  hydratedRouteWorkspaceId: WorkspaceId | null
  currentWorkspaceRuntimeId: string | null
  currentBranchName: string | null
  currentWorkspacePaneRoute: ParsedWorkspacePaneRoute | null
}

export function AppOverlays({
  overlays,
  workspaceDrop,
  navigation,
  hydratedRouteWorkspaceId,
  currentWorkspaceRuntimeId,
  currentBranchName,
  currentWorkspacePaneRoute,
}: AppOverlaysProps) {
  return (
    <>
      <WorkspaceOpenDialog open={overlays.state.openWorkspace.open} onOpenChange={overlays.setOpenWorkspaceOpen} />
      <RepoCloneDialog open={overlays.state.clone.open} onOpenChange={overlays.setCloneOpen} />
      <OpenRemoteWorkspaceDialog
        open={overlays.state.openRemoteWorkspace.open}
        onOpenChange={overlays.setOpenRemoteWorkspaceOpen}
      />
      <BranchActionDialogHost currentWorkspaceId={hydratedRouteWorkspaceId} currentBranchName={currentBranchName} />
      <FiletreeActionDialogHost
        currentWorkspaceId={hydratedRouteWorkspaceId}
        currentWorkspaceRuntimeId={currentWorkspaceRuntimeId}
      />
      <TerminalActionDialogHost
        currentWorkspaceId={hydratedRouteWorkspaceId}
        currentWorkspacePaneRoute={currentWorkspacePaneRoute}
        navigation={navigation}
      />
      <WorkspaceDropOverlay active={workspaceDrop.active} />
      <Toaster position="bottom-right" closeButton />
    </>
  )
}
