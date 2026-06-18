import type { ReposStore } from '#/web/stores/repos/types.ts'

export interface RestorableWorkspaceNavigationStoreActions extends Pick<
  ReposStore,
  'setActive' | 'reorderRepos' | 'cycleActive'
> {}

export interface RestorableWorkspaceViewportStoreActions extends Pick<ReposStore, 'setActive' | 'cycleActive'> {}

export interface RestorableWorkspaceOrderStoreActions extends Pick<ReposStore, 'reorderRepos'> {}

export interface RestorableWorkspaceLayoutStoreActions extends Pick<
  ReposStore,
  | 'setDetailCollapsed'
  | 'toggleDetailCollapsed'
  | 'toggleDetailFocusMode'
  | 'setWorkspaceLayout'
  | 'resetLayout'
  | 'setSelectedTerminal'
> {}

export interface RestorableWorkspaceDetailVisibilityStoreActions extends Pick<
  ReposStore,
  'setDetailCollapsed' | 'toggleDetailCollapsed'
> {}

export interface RestorableWorkspaceDetailFocusStoreActions extends Pick<ReposStore, 'toggleDetailFocusMode'> {}

export interface RestorableWorkspaceLayoutPreferenceStoreActions extends Pick<
  ReposStore,
  'setWorkspaceLayout' | 'resetLayout' | 'setSelectedTerminal'
> {}

export interface RuntimeCoherentRepoOpenStoreActions extends Pick<ReposStore, 'ensureWorkspaceOpen'> {}

export interface RuntimeCoherentRepoNavigationStoreActions extends Pick<
  ReposStore,
  'closeRepo' | 'selectBranch' | 'setDetailTab'
> {}

export interface RestorableWorkspaceStoreActions extends Pick<
  ReposStore,
  | 'setActive'
  | 'reorderRepos'
  | 'cycleActive'
  | 'setDetailCollapsed'
  | 'toggleDetailCollapsed'
  | 'toggleDetailFocusMode'
  | 'setWorkspaceLayout'
  | 'resetLayout'
  | 'setSelectedTerminal'
> {}

export interface RuntimeCoherentRepoProjectionStoreActions extends Pick<
  ReposStore,
  'ensureWorkspaceOpen' | 'closeRepo' | 'selectBranch' | 'setDetailTab'
> {}

export interface MainWindowNavigationStoreActions extends Pick<
  ReposStore,
  'setActive' | 'closeRepo' | 'cycleActive' | 'selectBranch' | 'setDetailTab'
> {}

export interface RepoTabStoreActions extends Pick<ReposStore, 'ensureWorkspaceOpen' | 'reorderRepos'> {}

export interface RendererEffectIntentStoreActions extends Pick<
  ReposStore,
  | 'ensureWorkspaceOpen'
  | 'setDetailCollapsed'
  | 'setSelectedTerminal'
  | 'setWorkspaceLayout'
  | 'toggleDetailCollapsed'
  | 'resetLayout'
> {}

export interface BranchDetailToolbarStoreActions extends Pick<
  ReposStore,
  'setDetailCollapsed' | 'toggleDetailCollapsed'
> {}

export interface DetailPanelStoreActions extends Pick<ReposStore, 'setDetailCollapsed'> {}

export function restorableWorkspaceViewportStoreActionsFromStore(
  state: Pick<ReposStore, 'setActive' | 'cycleActive'>,
): RestorableWorkspaceViewportStoreActions {
  return {
    setActive: state.setActive,
    cycleActive: state.cycleActive,
  }
}

export function restorableWorkspaceOrderStoreActionsFromStore(
  state: Pick<ReposStore, 'reorderRepos'>,
): RestorableWorkspaceOrderStoreActions {
  return {
    reorderRepos: state.reorderRepos,
  }
}

export function restorableWorkspaceNavigationStoreActionsFromStore(
  state: Pick<ReposStore, 'setActive' | 'reorderRepos' | 'cycleActive'>,
): RestorableWorkspaceNavigationStoreActions {
  return {
    setActive: state.setActive,
    reorderRepos: state.reorderRepos,
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
  state: Pick<ReposStore, 'closeRepo' | 'selectBranch' | 'setDetailTab'>,
): RuntimeCoherentRepoNavigationStoreActions {
  return {
    closeRepo: state.closeRepo,
    selectBranch: state.selectBranch,
    setDetailTab: state.setDetailTab,
  }
}

export function restorableWorkspaceLayoutStoreActionsFromStore(
  state: Pick<
    ReposStore,
    | 'setDetailCollapsed'
    | 'toggleDetailCollapsed'
    | 'toggleDetailFocusMode'
    | 'setWorkspaceLayout'
    | 'resetLayout'
    | 'setSelectedTerminal'
  >,
): RestorableWorkspaceLayoutStoreActions {
  return {
    setDetailCollapsed: state.setDetailCollapsed,
    toggleDetailCollapsed: state.toggleDetailCollapsed,
    toggleDetailFocusMode: state.toggleDetailFocusMode,
    setWorkspaceLayout: state.setWorkspaceLayout,
    resetLayout: state.resetLayout,
    setSelectedTerminal: state.setSelectedTerminal,
  }
}

export function restorableWorkspaceDetailVisibilityStoreActionsFromStore(
  state: Pick<ReposStore, 'setDetailCollapsed' | 'toggleDetailCollapsed'>,
): RestorableWorkspaceDetailVisibilityStoreActions {
  return {
    setDetailCollapsed: state.setDetailCollapsed,
    toggleDetailCollapsed: state.toggleDetailCollapsed,
  }
}

export function restorableWorkspaceDetailFocusStoreActionsFromStore(
  state: Pick<ReposStore, 'toggleDetailFocusMode'>,
): RestorableWorkspaceDetailFocusStoreActions {
  return {
    toggleDetailFocusMode: state.toggleDetailFocusMode,
  }
}

export function restorableWorkspaceLayoutPreferenceStoreActionsFromStore(
  state: Pick<ReposStore, 'setWorkspaceLayout' | 'resetLayout' | 'setSelectedTerminal'>,
): RestorableWorkspaceLayoutPreferenceStoreActions {
  return {
    setWorkspaceLayout: state.setWorkspaceLayout,
    resetLayout: state.resetLayout,
    setSelectedTerminal: state.setSelectedTerminal,
  }
}

export function restorableWorkspaceStoreActionsFromStore(
  state: Pick<
    ReposStore,
    | 'setActive'
    | 'reorderRepos'
    | 'cycleActive'
    | 'setDetailCollapsed'
    | 'toggleDetailCollapsed'
    | 'toggleDetailFocusMode'
    | 'setWorkspaceLayout'
    | 'resetLayout'
    | 'setSelectedTerminal'
  >,
): RestorableWorkspaceStoreActions {
  return {
    setActive: state.setActive,
    reorderRepos: state.reorderRepos,
    cycleActive: state.cycleActive,
    setDetailCollapsed: state.setDetailCollapsed,
    toggleDetailCollapsed: state.toggleDetailCollapsed,
    toggleDetailFocusMode: state.toggleDetailFocusMode,
    setWorkspaceLayout: state.setWorkspaceLayout,
    resetLayout: state.resetLayout,
    setSelectedTerminal: state.setSelectedTerminal,
  }
}

export function runtimeCoherentRepoProjectionStoreActionsFromStore(
  state: Pick<ReposStore, 'ensureWorkspaceOpen' | 'closeRepo' | 'selectBranch' | 'setDetailTab'>,
): RuntimeCoherentRepoProjectionStoreActions {
  const open = runtimeCoherentRepoOpenStoreActionsFromStore({ ensureWorkspaceOpen: state.ensureWorkspaceOpen })
  const navigation = runtimeCoherentRepoNavigationStoreActionsFromStore({
    closeRepo: state.closeRepo,
    selectBranch: state.selectBranch,
    setDetailTab: state.setDetailTab,
  })
  return {
    ensureWorkspaceOpen: open.ensureWorkspaceOpen,
    closeRepo: navigation.closeRepo,
    selectBranch: navigation.selectBranch,
    setDetailTab: navigation.setDetailTab,
  }
}

export function mainWindowNavigationStoreActionsFromStore(
  state: Pick<ReposStore, 'setActive' | 'cycleActive' | 'closeRepo' | 'selectBranch' | 'setDetailTab'>,
): MainWindowNavigationStoreActions {
  const restorable = restorableWorkspaceViewportStoreActionsFromStore({
    setActive: state.setActive,
    cycleActive: state.cycleActive,
  })
  const runtimeCoherent = runtimeCoherentRepoNavigationStoreActionsFromStore({
    closeRepo: state.closeRepo,
    selectBranch: state.selectBranch,
    setDetailTab: state.setDetailTab,
  })
  return {
    setActive: restorable.setActive,
    closeRepo: runtimeCoherent.closeRepo,
    cycleActive: restorable.cycleActive,
    selectBranch: runtimeCoherent.selectBranch,
    setDetailTab: runtimeCoherent.setDetailTab,
  }
}

export function repoTabStoreActionsFromStore(
  state: Pick<ReposStore, 'ensureWorkspaceOpen' | 'reorderRepos'>,
): RepoTabStoreActions {
  const restorable = restorableWorkspaceOrderStoreActionsFromStore({ reorderRepos: state.reorderRepos })
  const runtimeCoherent = runtimeCoherentRepoOpenStoreActionsFromStore({
    ensureWorkspaceOpen: state.ensureWorkspaceOpen,
  })
  return {
    ensureWorkspaceOpen: runtimeCoherent.ensureWorkspaceOpen,
    reorderRepos: restorable.reorderRepos,
  }
}

export function rendererEffectIntentStoreActionsFromStore(
  state: Pick<
    ReposStore,
    | 'ensureWorkspaceOpen'
    | 'setDetailCollapsed'
    | 'setSelectedTerminal'
    | 'setWorkspaceLayout'
    | 'toggleDetailCollapsed'
    | 'resetLayout'
  >,
): RendererEffectIntentStoreActions {
  const detailVisibility = restorableWorkspaceDetailVisibilityStoreActionsFromStore({
    setDetailCollapsed: state.setDetailCollapsed,
    toggleDetailCollapsed: state.toggleDetailCollapsed,
  })
  const layoutPrefs = restorableWorkspaceLayoutPreferenceStoreActionsFromStore({
    setWorkspaceLayout: state.setWorkspaceLayout,
    resetLayout: state.resetLayout,
    setSelectedTerminal: state.setSelectedTerminal,
  })
  const runtimeCoherent = runtimeCoherentRepoOpenStoreActionsFromStore({
    ensureWorkspaceOpen: state.ensureWorkspaceOpen,
  })
  return {
    ensureWorkspaceOpen: runtimeCoherent.ensureWorkspaceOpen,
    setDetailCollapsed: detailVisibility.setDetailCollapsed,
    setSelectedTerminal: layoutPrefs.setSelectedTerminal,
    setWorkspaceLayout: layoutPrefs.setWorkspaceLayout,
    toggleDetailCollapsed: detailVisibility.toggleDetailCollapsed,
    resetLayout: layoutPrefs.resetLayout,
  }
}

export function branchDetailToolbarStoreActionsFromStore(
  state: Pick<ReposStore, 'setDetailCollapsed' | 'toggleDetailCollapsed'>,
): BranchDetailToolbarStoreActions {
  const detailVisibility = restorableWorkspaceDetailVisibilityStoreActionsFromStore({
    setDetailCollapsed: state.setDetailCollapsed,
    toggleDetailCollapsed: state.toggleDetailCollapsed,
  })
  return {
    setDetailCollapsed: detailVisibility.setDetailCollapsed,
    toggleDetailCollapsed: detailVisibility.toggleDetailCollapsed,
  }
}

export function detailPanelStoreActionsFromStore(
  state: Pick<ReposStore, 'setDetailCollapsed'>,
): DetailPanelStoreActions {
  return {
    setDetailCollapsed: state.setDetailCollapsed,
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
    a.setDetailTab === b.setDetailTab
  )
}

export function repoTabStoreActionsEqual(a: RepoTabStoreActions, b: RepoTabStoreActions): boolean {
  return a.ensureWorkspaceOpen === b.ensureWorkspaceOpen && a.reorderRepos === b.reorderRepos
}

export function rendererEffectIntentStoreActionsEqual(
  a: RendererEffectIntentStoreActions,
  b: RendererEffectIntentStoreActions,
): boolean {
  return (
    a.ensureWorkspaceOpen === b.ensureWorkspaceOpen &&
    a.setDetailCollapsed === b.setDetailCollapsed &&
    a.setSelectedTerminal === b.setSelectedTerminal &&
    a.setWorkspaceLayout === b.setWorkspaceLayout &&
    a.toggleDetailCollapsed === b.toggleDetailCollapsed &&
    a.resetLayout === b.resetLayout
  )
}

export function branchDetailToolbarStoreActionsEqual(
  a: BranchDetailToolbarStoreActions,
  b: BranchDetailToolbarStoreActions,
): boolean {
  return a.setDetailCollapsed === b.setDetailCollapsed && a.toggleDetailCollapsed === b.toggleDetailCollapsed
}

export function detailPanelStoreActionsEqual(a: DetailPanelStoreActions, b: DetailPanelStoreActions): boolean {
  return a.setDetailCollapsed === b.setDetailCollapsed
}
