import type { WorkspacesStore } from '#/web/stores/workspaces/types.ts'

interface RestorableWorkspaceLayoutStoreActions extends Pick<
  WorkspacesStore,
  'resetLayout' | 'toggleZenMode'
> {}

interface RestorableWorkspaceLayoutPreferenceStoreActions extends Pick<
  WorkspacesStore,
  'resetLayout' | 'toggleZenMode'
> {}

interface RuntimeCoherentWorkspaceOpenStoreActions extends Pick<WorkspacesStore, 'ensureWorkspaceOpen'> {}

interface RuntimeCoherentWorkspaceNavigationStoreActions extends Pick<WorkspacesStore, 'closeWorkspace'> {}

interface RuntimeCoherentWorkspaceProjectionStoreActions extends Pick<
  WorkspacesStore,
  'ensureWorkspaceOpen' | 'closeWorkspace'
> {}

interface PrimaryWindowNavigationStoreActions
  extends Pick<WorkspacesStore, 'closeWorkspace' | 'peekWorkspaceNavigation' | 'commitWorkspaceNavigation'> {}

interface WorkspacePickerStoreActions extends Pick<WorkspacesStore, 'ensureWorkspaceOpen'> {}

interface ClientEffectIntentStoreActions extends Pick<
  WorkspacesStore,
  'ensureWorkspaceOpen' | 'resetLayout' | 'toggleZenMode'
> {}

export function runtimeCoherentWorkspaceOpenStoreActionsFromStore(
  state: Pick<WorkspacesStore, 'ensureWorkspaceOpen'>,
): RuntimeCoherentWorkspaceOpenStoreActions {
  return {
    ensureWorkspaceOpen: state.ensureWorkspaceOpen,
  }
}

export function runtimeCoherentWorkspaceNavigationStoreActionsFromStore(
  state: Pick<WorkspacesStore, 'closeWorkspace'>,
): RuntimeCoherentWorkspaceNavigationStoreActions {
  return {
    closeWorkspace: state.closeWorkspace,
  }
}

export function restorableWorkspaceLayoutStoreActionsFromStore(
  state: Pick<WorkspacesStore, 'resetLayout' | 'toggleZenMode'>,
): RestorableWorkspaceLayoutStoreActions {
  return {
    resetLayout: state.resetLayout,
    toggleZenMode: state.toggleZenMode,
  }
}

export function restorableWorkspaceLayoutPreferenceStoreActionsFromStore(
  state: Pick<WorkspacesStore, 'resetLayout' | 'toggleZenMode'>,
): RestorableWorkspaceLayoutPreferenceStoreActions {
  return {
    resetLayout: state.resetLayout,
    toggleZenMode: state.toggleZenMode,
  }
}

export function runtimeCoherentWorkspaceProjectionStoreActionsFromStore(
  state: Pick<WorkspacesStore, 'ensureWorkspaceOpen' | 'closeWorkspace'>,
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

export function primaryWindowNavigationStoreActionsFromStore(
  state: Pick<WorkspacesStore, 'closeWorkspace' | 'peekWorkspaceNavigation' | 'commitWorkspaceNavigation'>,
): PrimaryWindowNavigationStoreActions {
  return {
    closeWorkspace: state.closeWorkspace,
    peekWorkspaceNavigation: state.peekWorkspaceNavigation,
    commitWorkspaceNavigation: state.commitWorkspaceNavigation,
  }
}

export function workspacePickerStoreActionsFromStore(
  state: Pick<WorkspacesStore, 'ensureWorkspaceOpen'>,
): WorkspacePickerStoreActions {
  const runtimeCoherent = runtimeCoherentWorkspaceOpenStoreActionsFromStore({
    ensureWorkspaceOpen: state.ensureWorkspaceOpen,
  })
  return {
    ensureWorkspaceOpen: runtimeCoherent.ensureWorkspaceOpen,
  }
}

export function clientEffectIntentStoreActionsFromStore(
  state: Pick<WorkspacesStore, 'ensureWorkspaceOpen' | 'resetLayout' | 'toggleZenMode'>,
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
