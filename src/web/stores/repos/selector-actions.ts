import type { ReposStore } from '#/web/stores/repos/types.ts'

interface RestorableWorkspaceLayoutStoreActions extends Pick<
  ReposStore,
  'resetLayout' | 'setSelectedTerminal' | 'toggleZenMode'
> {}

interface RestorableWorkspaceLayoutPreferenceStoreActions extends Pick<
  ReposStore,
  'resetLayout' | 'setSelectedTerminal' | 'toggleZenMode'
> {}

interface RuntimeCoherentRepoOpenStoreActions extends Pick<ReposStore, 'ensureWorkspaceOpen'> {}

interface RuntimeCoherentRepoNavigationStoreActions extends Pick<
  ReposStore,
  'closeRepo' | 'setWorkspacePaneTab'
> {}

interface RuntimeCoherentRepoProjectionStoreActions extends Pick<
  ReposStore,
  'ensureWorkspaceOpen' | 'closeRepo' | 'setWorkspacePaneTab'
> {}

interface PrimaryWindowNavigationStoreActions extends Pick<
  ReposStore,
  'closeRepo' | 'setWorkspacePaneTab' | 'goBackInWorkspaceNavigation' | 'goForwardInWorkspaceNavigation'
> {}

interface RepoPickerStoreActions extends Pick<ReposStore, 'ensureWorkspaceOpen'> {}

interface ClientEffectIntentStoreActions extends Pick<
  ReposStore,
  'ensureWorkspaceOpen' | 'setSelectedTerminal' | 'resetLayout' | 'toggleZenMode'
> {}

export function runtimeCoherentRepoOpenStoreActionsFromStore(
  state: Pick<ReposStore, 'ensureWorkspaceOpen'>,
): RuntimeCoherentRepoOpenStoreActions {
  return {
    ensureWorkspaceOpen: state.ensureWorkspaceOpen,
  }
}

export function runtimeCoherentRepoNavigationStoreActionsFromStore(
  state: Pick<ReposStore, 'closeRepo' | 'setWorkspacePaneTab'>,
): RuntimeCoherentRepoNavigationStoreActions {
  return {
    closeRepo: state.closeRepo,
    setWorkspacePaneTab: state.setWorkspacePaneTab,
  }
}

export function restorableWorkspaceLayoutStoreActionsFromStore(
  state: Pick<ReposStore, 'resetLayout' | 'setSelectedTerminal' | 'toggleZenMode'>,
): RestorableWorkspaceLayoutStoreActions {
  return {
    resetLayout: state.resetLayout,
    setSelectedTerminal: state.setSelectedTerminal,
    toggleZenMode: state.toggleZenMode,
  }
}

export function restorableWorkspaceLayoutPreferenceStoreActionsFromStore(
  state: Pick<ReposStore, 'resetLayout' | 'setSelectedTerminal' | 'toggleZenMode'>,
): RestorableWorkspaceLayoutPreferenceStoreActions {
  return {
    resetLayout: state.resetLayout,
    setSelectedTerminal: state.setSelectedTerminal,
    toggleZenMode: state.toggleZenMode,
  }
}

export function runtimeCoherentRepoProjectionStoreActionsFromStore(
  state: Pick<ReposStore, 'ensureWorkspaceOpen' | 'closeRepo' | 'setWorkspacePaneTab'>,
): RuntimeCoherentRepoProjectionStoreActions {
  const open = runtimeCoherentRepoOpenStoreActionsFromStore({ ensureWorkspaceOpen: state.ensureWorkspaceOpen })
  const navigation = runtimeCoherentRepoNavigationStoreActionsFromStore({
    closeRepo: state.closeRepo,
    setWorkspacePaneTab: state.setWorkspacePaneTab,
  })
  return {
    ensureWorkspaceOpen: open.ensureWorkspaceOpen,
    closeRepo: navigation.closeRepo,
    setWorkspacePaneTab: navigation.setWorkspacePaneTab,
  }
}

export function primaryWindowNavigationStoreActionsFromStore(
  state: Pick<ReposStore, 'closeRepo' | 'setWorkspacePaneTab'> &
    Partial<Pick<ReposStore, 'goBackInWorkspaceNavigation' | 'goForwardInWorkspaceNavigation'>>,
): PrimaryWindowNavigationStoreActions {
  const runtimeCoherent = runtimeCoherentRepoNavigationStoreActionsFromStore({
    closeRepo: state.closeRepo,
    setWorkspacePaneTab: state.setWorkspacePaneTab,
  })
  return {
    closeRepo: runtimeCoherent.closeRepo,
    setWorkspacePaneTab: runtimeCoherent.setWorkspacePaneTab,
    goBackInWorkspaceNavigation: state.goBackInWorkspaceNavigation ?? (() => null),
    goForwardInWorkspaceNavigation: state.goForwardInWorkspaceNavigation ?? (() => null),
  }
}

export function repoPickerStoreActionsFromStore(
  state: Pick<ReposStore, 'ensureWorkspaceOpen'>,
): RepoPickerStoreActions {
  const runtimeCoherent = runtimeCoherentRepoOpenStoreActionsFromStore({
    ensureWorkspaceOpen: state.ensureWorkspaceOpen,
  })
  return {
    ensureWorkspaceOpen: runtimeCoherent.ensureWorkspaceOpen,
  }
}

export function clientEffectIntentStoreActionsFromStore(
  state: Pick<ReposStore, 'ensureWorkspaceOpen' | 'setSelectedTerminal' | 'resetLayout' | 'toggleZenMode'>,
): ClientEffectIntentStoreActions {
  const runtimeCoherent = runtimeCoherentRepoOpenStoreActionsFromStore({
    ensureWorkspaceOpen: state.ensureWorkspaceOpen,
  })
  return {
    ensureWorkspaceOpen: runtimeCoherent.ensureWorkspaceOpen,
    setSelectedTerminal: state.setSelectedTerminal,
    resetLayout: state.resetLayout,
    toggleZenMode: state.toggleZenMode,
  }
}
