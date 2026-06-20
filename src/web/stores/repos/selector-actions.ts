import type { ReposStore } from '#/web/stores/repos/types.ts'

export interface RestorableWorkspaceNavigationStoreActions extends Pick<
  ReposStore,
  'setActive' | 'reorderRepos' | 'cycleActive'
> {}

export interface RestorableWorkspaceViewportStoreActions extends Pick<ReposStore, 'setActive' | 'cycleActive'> {}

export interface RestorableWorkspaceOrderStoreActions extends Pick<ReposStore, 'reorderRepos'> {}

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

export interface RestorableWorkspaceStoreActions extends Pick<
  ReposStore,
  'setActive' | 'reorderRepos' | 'cycleActive' | 'resetLayout' | 'setSelectedTerminal' | 'toggleWorkspaceFocused'
> {}

export interface RuntimeCoherentRepoProjectionStoreActions extends Pick<
  ReposStore,
  'ensureWorkspaceOpen' | 'closeRepo' | 'selectBranch' | 'setWorkspacePaneView'
> {}

export interface MainWindowNavigationStoreActions extends Pick<
  ReposStore,
  'setActive' | 'closeRepo' | 'cycleActive' | 'selectBranch' | 'setWorkspacePaneView'
> {}

export interface RepoTabStoreActions extends Pick<ReposStore, 'ensureWorkspaceOpen'> {}

export interface RendererEffectIntentStoreActions extends Pick<
  ReposStore,
  'ensureWorkspaceOpen' | 'setSelectedTerminal' | 'resetLayout'
> {}

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

export function restorableWorkspaceStoreActionsFromStore(
  state: Pick<
    ReposStore,
    'setActive' | 'reorderRepos' | 'cycleActive' | 'resetLayout' | 'setSelectedTerminal' | 'toggleWorkspaceFocused'
  >,
): RestorableWorkspaceStoreActions {
  return {
    setActive: state.setActive,
    reorderRepos: state.reorderRepos,
    cycleActive: state.cycleActive,
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

export function repoTabStoreActionsFromStore(state: Pick<ReposStore, 'ensureWorkspaceOpen'>): RepoTabStoreActions {
  const runtimeCoherent = runtimeCoherentRepoOpenStoreActionsFromStore({
    ensureWorkspaceOpen: state.ensureWorkspaceOpen,
  })
  return {
    ensureWorkspaceOpen: runtimeCoherent.ensureWorkspaceOpen,
  }
}

export function rendererEffectIntentStoreActionsFromStore(
  state: Pick<ReposStore, 'ensureWorkspaceOpen' | 'setSelectedTerminal' | 'resetLayout'>,
): RendererEffectIntentStoreActions {
  const runtimeCoherent = runtimeCoherentRepoOpenStoreActionsFromStore({
    ensureWorkspaceOpen: state.ensureWorkspaceOpen,
  })
  return {
    ensureWorkspaceOpen: runtimeCoherent.ensureWorkspaceOpen,
    setSelectedTerminal: state.setSelectedTerminal,
    resetLayout: state.resetLayout,
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

export function repoTabStoreActionsEqual(a: RepoTabStoreActions, b: RepoTabStoreActions): boolean {
  return a.ensureWorkspaceOpen === b.ensureWorkspaceOpen
}

export function rendererEffectIntentStoreActionsEqual(
  a: RendererEffectIntentStoreActions,
  b: RendererEffectIntentStoreActions,
): boolean {
  return (
    a.ensureWorkspaceOpen === b.ensureWorkspaceOpen &&
    a.setSelectedTerminal === b.setSelectedTerminal &&
    a.resetLayout === b.resetLayout
  )
}
