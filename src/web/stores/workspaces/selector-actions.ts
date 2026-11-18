import type { WorkspaceMembershipActions, WorkspaceNavigationHistoryActions } from '#/web/stores/workspaces/types.ts'

interface RuntimeCoherentWorkspaceOpenStoreActions {
  openWorkspaceMembership: WorkspaceMembershipActions['openWorkspaceMembership']
}

interface RuntimeCoherentWorkspaceNavigationStoreActions {
  closeWorkspace: WorkspaceMembershipActions['closeWorkspace']
}

interface AppNavigationStoreActions extends RuntimeCoherentWorkspaceNavigationStoreActions {
  peekWorkspaceNavigation: WorkspaceNavigationHistoryActions['peekWorkspaceNavigation']
  commitWorkspaceNavigation: WorkspaceNavigationHistoryActions['commitWorkspaceNavigation']
}

export function runtimeCoherentWorkspaceOpenStoreActionsFromStore(
  state: RuntimeCoherentWorkspaceOpenStoreActions,
): RuntimeCoherentWorkspaceOpenStoreActions {
  return {
    openWorkspaceMembership: state.openWorkspaceMembership,
  }
}

export function runtimeCoherentWorkspaceNavigationStoreActionsFromStore(
  state: RuntimeCoherentWorkspaceNavigationStoreActions,
): RuntimeCoherentWorkspaceNavigationStoreActions {
  return {
    closeWorkspace: state.closeWorkspace,
  }
}

export function appNavigationStoreActionsFromStore(state: AppNavigationStoreActions): AppNavigationStoreActions {
  return {
    closeWorkspace: state.closeWorkspace,
    peekWorkspaceNavigation: state.peekWorkspaceNavigation,
    commitWorkspaceNavigation: state.commitWorkspaceNavigation,
  }
}
