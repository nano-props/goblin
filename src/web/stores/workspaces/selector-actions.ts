import type {
  RestorableWorkspaceActions,
  WorkspaceMembershipActions,
  WorkspaceNavigationHistoryActions,
} from '#/web/stores/workspaces/types.ts'

interface RestorableWorkspaceLayoutStoreActions {
  resetLayout: RestorableWorkspaceActions['resetLayout']
  toggleZenMode: RestorableWorkspaceActions['toggleZenMode']
}

interface RestorableWorkspaceLayoutPreferenceStoreActions extends RestorableWorkspaceLayoutStoreActions {}

interface RuntimeCoherentWorkspaceOpenStoreActions {
  openWorkspaceMembership: WorkspaceMembershipActions['openWorkspaceMembership']
}

interface RuntimeCoherentWorkspaceNavigationStoreActions {
  closeWorkspace: WorkspaceMembershipActions['closeWorkspace']
}

interface RuntimeCoherentWorkspaceProjectionStoreActions
  extends RuntimeCoherentWorkspaceOpenStoreActions, RuntimeCoherentWorkspaceNavigationStoreActions {}

interface AppNavigationStoreActions extends RuntimeCoherentWorkspaceNavigationStoreActions {
  peekWorkspaceNavigation: WorkspaceNavigationHistoryActions['peekWorkspaceNavigation']
  commitWorkspaceNavigation: WorkspaceNavigationHistoryActions['commitWorkspaceNavigation']
}

interface WorkspacePickerStoreActions extends RuntimeCoherentWorkspaceOpenStoreActions {}

interface ClientEffectIntentStoreActions
  extends RuntimeCoherentWorkspaceOpenStoreActions, RestorableWorkspaceLayoutStoreActions {}

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

export function restorableWorkspaceLayoutStoreActionsFromStore(
  state: RestorableWorkspaceLayoutStoreActions,
): RestorableWorkspaceLayoutStoreActions {
  return {
    resetLayout: state.resetLayout,
    toggleZenMode: state.toggleZenMode,
  }
}

export function restorableWorkspaceLayoutPreferenceStoreActionsFromStore(
  state: RestorableWorkspaceLayoutPreferenceStoreActions,
): RestorableWorkspaceLayoutPreferenceStoreActions {
  return {
    resetLayout: state.resetLayout,
    toggleZenMode: state.toggleZenMode,
  }
}

export function runtimeCoherentWorkspaceProjectionStoreActionsFromStore(
  state: RuntimeCoherentWorkspaceProjectionStoreActions,
): RuntimeCoherentWorkspaceProjectionStoreActions {
  const open = runtimeCoherentWorkspaceOpenStoreActionsFromStore({
    openWorkspaceMembership: state.openWorkspaceMembership,
  })
  const navigation = runtimeCoherentWorkspaceNavigationStoreActionsFromStore({
    closeWorkspace: state.closeWorkspace,
  })
  return {
    openWorkspaceMembership: open.openWorkspaceMembership,
    closeWorkspace: navigation.closeWorkspace,
  }
}

export function appNavigationStoreActionsFromStore(state: AppNavigationStoreActions): AppNavigationStoreActions {
  return {
    closeWorkspace: state.closeWorkspace,
    peekWorkspaceNavigation: state.peekWorkspaceNavigation,
    commitWorkspaceNavigation: state.commitWorkspaceNavigation,
  }
}

export function workspacePickerStoreActionsFromStore(state: WorkspacePickerStoreActions): WorkspacePickerStoreActions {
  const runtimeCoherent = runtimeCoherentWorkspaceOpenStoreActionsFromStore({
    openWorkspaceMembership: state.openWorkspaceMembership,
  })
  return {
    openWorkspaceMembership: runtimeCoherent.openWorkspaceMembership,
  }
}

export function clientEffectIntentStoreActionsFromStore(
  state: ClientEffectIntentStoreActions,
): ClientEffectIntentStoreActions {
  const runtimeCoherent = runtimeCoherentWorkspaceOpenStoreActionsFromStore({
    openWorkspaceMembership: state.openWorkspaceMembership,
  })
  return {
    openWorkspaceMembership: runtimeCoherent.openWorkspaceMembership,
    resetLayout: state.resetLayout,
    toggleZenMode: state.toggleZenMode,
  }
}
