import type { ReposStore } from '#/web/stores/repos/types.ts'

interface RestorableWorkspaceLayoutStoreActions extends Pick<
  ReposStore,
  'resetLayout' | 'toggleZenMode'
> {}

interface RestorableWorkspaceLayoutPreferenceStoreActions extends Pick<
  ReposStore,
  'resetLayout' | 'toggleZenMode'
> {}

interface RuntimeCoherentWorkspaceOpenStoreActions extends Pick<ReposStore, 'ensureWorkspaceOpen'> {}

interface RuntimeCoherentWorkspaceNavigationStoreActions extends Pick<ReposStore, 'closeWorkspace'> {}

interface RuntimeCoherentWorkspaceProjectionStoreActions extends Pick<
  ReposStore,
  'ensureWorkspaceOpen' | 'closeWorkspace'
> {}

interface PrimaryWindowNavigationStoreActions
  extends Pick<ReposStore, 'closeWorkspace' | 'peekWorkspaceNavigation' | 'commitWorkspaceNavigation'> {}

interface WorkspacePickerStoreActions extends Pick<ReposStore, 'ensureWorkspaceOpen'> {}

interface ClientEffectIntentStoreActions extends Pick<
  ReposStore,
  'ensureWorkspaceOpen' | 'resetLayout' | 'toggleZenMode'
> {}

export function runtimeCoherentWorkspaceOpenStoreActionsFromStore(
  state: Pick<ReposStore, 'ensureWorkspaceOpen'>,
): RuntimeCoherentWorkspaceOpenStoreActions {
  return {
    ensureWorkspaceOpen: state.ensureWorkspaceOpen,
  }
}

export function runtimeCoherentWorkspaceNavigationStoreActionsFromStore(
  state: Pick<ReposStore, 'closeWorkspace'>,
): RuntimeCoherentWorkspaceNavigationStoreActions {
  return {
    closeWorkspace: state.closeWorkspace,
  }
}

export function restorableWorkspaceLayoutStoreActionsFromStore(
  state: Pick<ReposStore, 'resetLayout' | 'toggleZenMode'>,
): RestorableWorkspaceLayoutStoreActions {
  return {
    resetLayout: state.resetLayout,
    toggleZenMode: state.toggleZenMode,
  }
}

export function restorableWorkspaceLayoutPreferenceStoreActionsFromStore(
  state: Pick<ReposStore, 'resetLayout' | 'toggleZenMode'>,
): RestorableWorkspaceLayoutPreferenceStoreActions {
  return {
    resetLayout: state.resetLayout,
    toggleZenMode: state.toggleZenMode,
  }
}

export function runtimeCoherentWorkspaceProjectionStoreActionsFromStore(
  state: Pick<ReposStore, 'ensureWorkspaceOpen' | 'closeWorkspace'>,
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
  state: Pick<ReposStore, 'closeWorkspace' | 'peekWorkspaceNavigation' | 'commitWorkspaceNavigation'>,
): PrimaryWindowNavigationStoreActions {
  return {
    closeWorkspace: state.closeWorkspace,
    peekWorkspaceNavigation: state.peekWorkspaceNavigation,
    commitWorkspaceNavigation: state.commitWorkspaceNavigation,
  }
}

export function workspacePickerStoreActionsFromStore(
  state: Pick<ReposStore, 'ensureWorkspaceOpen'>,
): WorkspacePickerStoreActions {
  const runtimeCoherent = runtimeCoherentWorkspaceOpenStoreActionsFromStore({
    ensureWorkspaceOpen: state.ensureWorkspaceOpen,
  })
  return {
    ensureWorkspaceOpen: runtimeCoherent.ensureWorkspaceOpen,
  }
}

export function clientEffectIntentStoreActionsFromStore(
  state: Pick<ReposStore, 'ensureWorkspaceOpen' | 'resetLayout' | 'toggleZenMode'>,
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
