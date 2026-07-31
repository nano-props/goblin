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
  ensureWorkspaceOpen: WorkspaceMembershipActions['ensureWorkspaceOpen']
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
    ensureWorkspaceOpen: state.ensureWorkspaceOpen,
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
  const open = runtimeCoherentWorkspaceOpenStoreActionsFromStore({ ensureWorkspaceOpen: state.ensureWorkspaceOpen })
  const navigation = runtimeCoherentWorkspaceNavigationStoreActionsFromStore({
    closeWorkspace: state.closeWorkspace,
  })
  return {
    ensureWorkspaceOpen: open.ensureWorkspaceOpen,
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
    ensureWorkspaceOpen: state.ensureWorkspaceOpen,
  })
  return {
    ensureWorkspaceOpen: runtimeCoherent.ensureWorkspaceOpen,
  }
}

export function clientEffectIntentStoreActionsFromStore(
  state: ClientEffectIntentStoreActions,
): ClientEffectIntentStoreActions {
  const runtimeCoherent = runtimeCoherentWorkspaceOpenStoreActionsFromStore({
    ensureWorkspaceOpen: state.ensureWorkspaceOpen,
  })
  return {
    ensureWorkspaceOpen: runtimeCoherent.ensureWorkspaceOpen,
    resetLayout: state.resetLayout,
    toggleZenMode: state.toggleZenMode,
  }
}
