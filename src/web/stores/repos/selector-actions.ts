import type { ReposStore } from '#/web/stores/repos/types.ts'

export interface RestorableWorkspaceViewportStoreActions extends Pick<ReposStore, 'setActive' | 'cycleActive'> {}

export interface RestorableWorkspaceLayoutStoreActions extends Pick<
  ReposStore,
  'resetLayout' | 'setSelectedTerminal' | 'toggleZenMode'
> {}

export interface RestorableWorkspaceLayoutPreferenceStoreActions extends Pick<
  ReposStore,
  'resetLayout' | 'setSelectedTerminal' | 'toggleZenMode'
> {}

export interface RuntimeCoherentRepoOpenStoreActions extends Pick<ReposStore, 'ensureWorkspaceOpen'> {}

export interface RuntimeCoherentRepoNavigationStoreActions extends Pick<
  ReposStore,
  'closeRepo' | 'selectBranch' | 'setWorkspacePaneView'
> {}

export interface RuntimeCoherentRepoProjectionStoreActions extends Pick<
  ReposStore,
  'ensureWorkspaceOpen' | 'closeRepo' | 'selectBranch' | 'setWorkspacePaneView'
> {}

export interface MainWindowNavigationStoreActions extends Pick<
  ReposStore,
  'setActive' | 'closeRepo' | 'cycleActive' | 'selectBranch' | 'setWorkspacePaneView'
> {}

export interface RepoPickerStoreActions extends Pick<ReposStore, 'ensureWorkspaceOpen'> {}

export interface ClientEffectIntentStoreActions extends Pick<
  ReposStore,
  'ensureWorkspaceOpen' | 'setSelectedTerminal' | 'resetLayout' | 'toggleZenMode'
> {}

export function restorableWorkspaceViewportStoreActionsFromStore(
  state: Pick<ReposStore, 'setActive' | 'cycleActive'>,
): RestorableWorkspaceViewportStoreActions {
  return {
    setActive: state.setActive,
    cycleActive: state.cycleActive,
  }
}

export function runtimeCoherentRepoOpenStoreActionsFromStore(
  state: Pick<ReposStore, 'ensureWorkspaceOpen'>,
): RuntimeCoherentRepoOpenStoreActions {
  return {
    ensureWorkspaceOpen: state.ensureWorkspaceOpen,
  }
}

export function runtimeCoherentRepoNavigationStoreActionsFromStore(
  state: Pick<ReposStore, 'closeRepo' | 'selectBranch' | 'setWorkspacePaneView'>,
): RuntimeCoherentRepoNavigationStoreActions {
  return {
    closeRepo: state.closeRepo,
    selectBranch: state.selectBranch,
    setWorkspacePaneView: state.setWorkspacePaneView,
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
  state: Pick<ReposStore, 'ensureWorkspaceOpen' | 'closeRepo' | 'selectBranch' | 'setWorkspacePaneView'>,
): RuntimeCoherentRepoProjectionStoreActions {
  const open = runtimeCoherentRepoOpenStoreActionsFromStore({ ensureWorkspaceOpen: state.ensureWorkspaceOpen })
  const navigation = runtimeCoherentRepoNavigationStoreActionsFromStore({
    closeRepo: state.closeRepo,
    selectBranch: state.selectBranch,
    setWorkspacePaneView: state.setWorkspacePaneView,
  })
  return {
    ensureWorkspaceOpen: open.ensureWorkspaceOpen,
    closeRepo: navigation.closeRepo,
    selectBranch: navigation.selectBranch,
    setWorkspacePaneView: navigation.setWorkspacePaneView,
  }
}

export function mainWindowNavigationStoreActionsFromStore(
  state: Pick<ReposStore, 'setActive' | 'cycleActive' | 'closeRepo' | 'selectBranch' | 'setWorkspacePaneView'>,
): MainWindowNavigationStoreActions {
  const restorable = restorableWorkspaceViewportStoreActionsFromStore({
    setActive: state.setActive,
    cycleActive: state.cycleActive,
  })
  const runtimeCoherent = runtimeCoherentRepoNavigationStoreActionsFromStore({
    closeRepo: state.closeRepo,
    selectBranch: state.selectBranch,
    setWorkspacePaneView: state.setWorkspacePaneView,
  })
  return {
    setActive: restorable.setActive,
    closeRepo: runtimeCoherent.closeRepo,
    cycleActive: restorable.cycleActive,
    selectBranch: runtimeCoherent.selectBranch,
    setWorkspacePaneView: runtimeCoherent.setWorkspacePaneView,
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

export function mainWindowNavigationStoreActionsEqual(
  a: MainWindowNavigationStoreActions,
  b: MainWindowNavigationStoreActions,
): boolean {
  return (
    a.setActive === b.setActive &&
    a.closeRepo === b.closeRepo &&
    a.cycleActive === b.cycleActive &&
    a.selectBranch === b.selectBranch &&
    a.setWorkspacePaneView === b.setWorkspacePaneView
  )
}

export function repoPickerStoreActionsEqual(a: RepoPickerStoreActions, b: RepoPickerStoreActions): boolean {
  return a.ensureWorkspaceOpen === b.ensureWorkspaceOpen
}

export function clientEffectIntentStoreActionsEqual(
  a: ClientEffectIntentStoreActions,
  b: ClientEffectIntentStoreActions,
): boolean {
  return (
    a.ensureWorkspaceOpen === b.ensureWorkspaceOpen &&
    a.setSelectedTerminal === b.setSelectedTerminal &&
    a.resetLayout === b.resetLayout &&
    a.toggleZenMode === b.toggleZenMode
  )
}
