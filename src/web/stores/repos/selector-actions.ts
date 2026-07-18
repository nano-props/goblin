import type { ReposStore } from '#/web/stores/repos/types.ts'

interface RestorableWorkspaceLayoutStoreActions extends Pick<
  ReposStore,
  'resetLayout' | 'toggleZenMode'
> {}

interface RestorableWorkspaceLayoutPreferenceStoreActions extends Pick<
  ReposStore,
  'resetLayout' | 'toggleZenMode'
> {}

interface RuntimeCoherentRepoOpenStoreActions extends Pick<ReposStore, 'ensureWorkspaceOpen'> {}

interface RuntimeCoherentRepoNavigationStoreActions extends Pick<ReposStore, 'closeRepo'> {}

interface RuntimeCoherentRepoProjectionStoreActions extends Pick<
  ReposStore,
  'ensureWorkspaceOpen' | 'closeRepo'
> {}

interface PrimaryWindowNavigationStoreActions
  extends Pick<ReposStore, 'closeRepo' | 'peekWorkspaceNavigation' | 'commitWorkspaceNavigation'> {}

interface WorkspacePickerStoreActions extends Pick<ReposStore, 'ensureWorkspaceOpen'> {}

interface ClientEffectIntentStoreActions extends Pick<
  ReposStore,
  'ensureWorkspaceOpen' | 'resetLayout' | 'toggleZenMode'
> {}

export function runtimeCoherentRepoOpenStoreActionsFromStore(
  state: Pick<ReposStore, 'ensureWorkspaceOpen'>,
): RuntimeCoherentRepoOpenStoreActions {
  return {
    ensureWorkspaceOpen: state.ensureWorkspaceOpen,
  }
}

export function runtimeCoherentRepoNavigationStoreActionsFromStore(
  state: Pick<ReposStore, 'closeRepo'>,
): RuntimeCoherentRepoNavigationStoreActions {
  return {
    closeRepo: state.closeRepo,
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

export function runtimeCoherentRepoProjectionStoreActionsFromStore(
  state: Pick<ReposStore, 'ensureWorkspaceOpen' | 'closeRepo'>,
): RuntimeCoherentRepoProjectionStoreActions {
  const open = runtimeCoherentRepoOpenStoreActionsFromStore({ ensureWorkspaceOpen: state.ensureWorkspaceOpen })
  const navigation = runtimeCoherentRepoNavigationStoreActionsFromStore({
    closeRepo: state.closeRepo,
  })
  return {
    ensureWorkspaceOpen: open.ensureWorkspaceOpen,
    closeRepo: navigation.closeRepo,
  }
}

export function primaryWindowNavigationStoreActionsFromStore(
  state: Pick<ReposStore, 'closeRepo' | 'peekWorkspaceNavigation' | 'commitWorkspaceNavigation'>,
): PrimaryWindowNavigationStoreActions {
  return {
    closeRepo: state.closeRepo,
    peekWorkspaceNavigation: state.peekWorkspaceNavigation,
    commitWorkspaceNavigation: state.commitWorkspaceNavigation,
  }
}

export function workspacePickerStoreActionsFromStore(
  state: Pick<ReposStore, 'ensureWorkspaceOpen'>,
): WorkspacePickerStoreActions {
  const runtimeCoherent = runtimeCoherentRepoOpenStoreActionsFromStore({
    ensureWorkspaceOpen: state.ensureWorkspaceOpen,
  })
  return {
    ensureWorkspaceOpen: runtimeCoherent.ensureWorkspaceOpen,
  }
}

export function clientEffectIntentStoreActionsFromStore(
  state: Pick<ReposStore, 'ensureWorkspaceOpen' | 'resetLayout' | 'toggleZenMode'>,
): ClientEffectIntentStoreActions {
  const runtimeCoherent = runtimeCoherentRepoOpenStoreActionsFromStore({
    ensureWorkspaceOpen: state.ensureWorkspaceOpen,
  })
  return {
    ensureWorkspaceOpen: runtimeCoherent.ensureWorkspaceOpen,
    resetLayout: state.resetLayout,
    toggleZenMode: state.toggleZenMode,
  }
}
