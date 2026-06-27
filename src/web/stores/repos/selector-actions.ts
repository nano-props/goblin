import type { ReposStore } from '#/web/stores/repos/types.ts'

interface RestorableWorkspaceViewportStoreActions extends Pick<ReposStore, 'setActive' | 'cycleActive'> {}

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
  'closeRepo' | 'selectBranch' | 'setWorkspacePaneTab'
> {}

interface RuntimeCoherentRepoProjectionStoreActions extends Pick<
  ReposStore,
  'ensureWorkspaceOpen' | 'closeRepo' | 'selectBranch' | 'setWorkspacePaneTab'
> {}

interface PrimaryWindowNavigationStoreActions extends Pick<
  ReposStore,
  'setActive' | 'closeRepo' | 'cycleActive' | 'selectBranch' | 'setWorkspacePaneTab'
> {}

interface RepoPickerStoreActions extends Pick<ReposStore, 'ensureWorkspaceOpen'> {}

interface ClientEffectIntentStoreActions extends Pick<
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
  state: Pick<ReposStore, 'closeRepo' | 'selectBranch' | 'setWorkspacePaneTab'>,
): RuntimeCoherentRepoNavigationStoreActions {
  return {
    closeRepo: state.closeRepo,
    selectBranch: state.selectBranch,
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
  state: Pick<ReposStore, 'ensureWorkspaceOpen' | 'closeRepo' | 'selectBranch' | 'setWorkspacePaneTab'>,
): RuntimeCoherentRepoProjectionStoreActions {
  const open = runtimeCoherentRepoOpenStoreActionsFromStore({ ensureWorkspaceOpen: state.ensureWorkspaceOpen })
  const navigation = runtimeCoherentRepoNavigationStoreActionsFromStore({
    closeRepo: state.closeRepo,
    selectBranch: state.selectBranch,
    setWorkspacePaneTab: state.setWorkspacePaneTab,
  })
  return {
    ensureWorkspaceOpen: open.ensureWorkspaceOpen,
    closeRepo: navigation.closeRepo,
    selectBranch: navigation.selectBranch,
    setWorkspacePaneTab: navigation.setWorkspacePaneTab,
  }
}

export function primaryWindowNavigationStoreActionsFromStore(
  state: Pick<ReposStore, 'setActive' | 'cycleActive' | 'closeRepo' | 'selectBranch' | 'setWorkspacePaneTab'>,
): PrimaryWindowNavigationStoreActions {
  const restorable = restorableWorkspaceViewportStoreActionsFromStore({
    setActive: state.setActive,
    cycleActive: state.cycleActive,
  })
  const runtimeCoherent = runtimeCoherentRepoNavigationStoreActionsFromStore({
    closeRepo: state.closeRepo,
    selectBranch: state.selectBranch,
    setWorkspacePaneTab: state.setWorkspacePaneTab,
  })
  return {
    setActive: restorable.setActive,
    closeRepo: runtimeCoherent.closeRepo,
    cycleActive: restorable.cycleActive,
    selectBranch: runtimeCoherent.selectBranch,
    setWorkspacePaneTab: runtimeCoherent.setWorkspacePaneTab,
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

export function primaryWindowNavigationStoreActionsEqual(
  a: PrimaryWindowNavigationStoreActions,
  b: PrimaryWindowNavigationStoreActions,
): boolean {
  return (
    a.setActive === b.setActive &&
    a.closeRepo === b.closeRepo &&
    a.cycleActive === b.cycleActive &&
    a.selectBranch === b.selectBranch &&
    a.setWorkspacePaneTab === b.setWorkspacePaneTab
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
