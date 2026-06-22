import type { ReposStore } from '#/web/stores/repos/types.ts'

export interface RestorableWorkspaceViewportStoreActions extends Pick<ReposStore, 'setActive' | 'cycleActive'> {}

export interface RestorableWorkspaceLayoutStoreActions extends Pick<
  ReposStore,
  'resetLayout' | 'setSelectedTerminal' | 'toggleWorkspaceFocused'
> {}

export interface RestorableWorkspaceLayoutPreferenceStoreActions extends Pick<
  ReposStore,
  'resetLayout' | 'setSelectedTerminal' | 'toggleWorkspaceFocused'
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

export interface RendererEffectIntentStoreActions extends Pick<
  ReposStore,
  'ensureWorkspaceOpen' | 'setSelectedTerminal' | 'resetLayout' | 'toggleWorkspaceFocused'
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
  state: Pick<ReposStore, 'resetLayout' | 'setSelectedTerminal' | 'toggleWorkspaceFocused'>,
): RestorableWorkspaceLayoutStoreActions {
  return {
    resetLayout: state.resetLayout,
    setSelectedTerminal: state.setSelectedTerminal,
    toggleWorkspaceFocused: state.toggleWorkspaceFocused,
  }
}

export function restorableWorkspaceLayoutPreferenceStoreActionsFromStore(
  state: Pick<ReposStore, 'resetLayout' | 'setSelectedTerminal' | 'toggleWorkspaceFocused'>,
): RestorableWorkspaceLayoutPreferenceStoreActions {
  return {
    resetLayout: state.resetLayout,
    setSelectedTerminal: state.setSelectedTerminal,
    toggleWorkspaceFocused: state.toggleWorkspaceFocused,
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

export function rendererEffectIntentStoreActionsFromStore(
  state: Pick<ReposStore, 'ensureWorkspaceOpen' | 'setSelectedTerminal' | 'resetLayout' | 'toggleWorkspaceFocused'>,
): RendererEffectIntentStoreActions {
  const runtimeCoherent = runtimeCoherentRepoOpenStoreActionsFromStore({
    ensureWorkspaceOpen: state.ensureWorkspaceOpen,
  })
  return {
    ensureWorkspaceOpen: runtimeCoherent.ensureWorkspaceOpen,
    setSelectedTerminal: state.setSelectedTerminal,
    resetLayout: state.resetLayout,
    toggleWorkspaceFocused: state.toggleWorkspaceFocused,
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

export function rendererEffectIntentStoreActionsEqual(
  a: RendererEffectIntentStoreActions,
  b: RendererEffectIntentStoreActions,
): boolean {
  return (
    a.ensureWorkspaceOpen === b.ensureWorkspaceOpen &&
    a.setSelectedTerminal === b.setSelectedTerminal &&
    a.resetLayout === b.resetLayout &&
    a.toggleWorkspaceFocused === b.toggleWorkspaceFocused
  )
}
