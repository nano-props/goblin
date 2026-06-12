import type {
  LocalWorkspaceState,
  RepoState,
  ReposStore,
  RestorableWorkspaceState,
  RuntimeCoherentRepoProjectionState,
} from '#/web/stores/repos/types.ts'

export interface MainWindowWorkspaceState extends Pick<
  ReposStore,
  'activeId' | 'order' | 'detailCollapsed' | 'detailFocusMode' | 'workspaceLayout' | 'sessionReady'
> {}

export interface MainWindowNavigationState extends Pick<ReposStore, 'activeId' | 'order'> {}

export interface KeyboardRuntimeState {
  detailCollapsed: boolean
  repo: RepoState | null
  searchQuery: string
}

export interface RestorableWorkspaceViewportState extends Pick<
  ReposStore,
  'activeId' | 'order' | 'detailCollapsed' | 'detailFocusMode' | 'workspaceLayout'
> {}

export interface RestorableWorkspaceNavigationState extends Pick<ReposStore, 'activeId' | 'order'> {}

export interface LocalWorkspaceSessionState extends Pick<ReposStore, 'sessionReady'> {}

export interface LocalWorkspaceSearchState extends Pick<ReposStore, 'branchSearchQueries'> {}

export function runtimeCoherentRepoProjectionStateFromStore(
  state: Pick<ReposStore, 'repos'>,
): RuntimeCoherentRepoProjectionState {
  return {
    repos: state.repos,
  }
}

export function restorableWorkspaceStateFromStore(
  state: Pick<
    ReposStore,
    | 'order'
    | 'activeId'
    | 'detailCollapsed'
    | 'detailFocusMode'
    | 'workspaceLayout'
    | 'detailPaneSizes'
    | 'selectedTerminalByWorktree'
  >,
): RestorableWorkspaceState {
  return {
    order: state.order,
    activeId: state.activeId,
    detailCollapsed: state.detailCollapsed,
    detailFocusMode: state.detailFocusMode,
    workspaceLayout: state.workspaceLayout,
    detailPaneSizes: state.detailPaneSizes,
    selectedTerminalByWorktree: state.selectedTerminalByWorktree,
  }
}

export function localWorkspaceStateFromStore(
  state: Pick<ReposStore, 'sessionReady' | 'branchSearchQueries'>,
): LocalWorkspaceState {
  return {
    sessionReady: state.sessionReady,
    branchSearchQueries: state.branchSearchQueries,
  }
}

function restorableWorkspaceViewportStateFromStore(
  state: Pick<ReposStore, 'activeId' | 'order' | 'detailCollapsed' | 'detailFocusMode' | 'workspaceLayout'>,
): RestorableWorkspaceViewportState {
  return {
    activeId: state.activeId,
    order: state.order,
    detailCollapsed: state.detailCollapsed,
    detailFocusMode: state.detailFocusMode,
    workspaceLayout: state.workspaceLayout,
  }
}

export function restorableWorkspaceNavigationStateFromStore(
  state: Pick<ReposStore, 'activeId' | 'order'>,
): RestorableWorkspaceNavigationState {
  return {
    activeId: state.activeId,
    order: state.order,
  }
}

export function localWorkspaceSessionStateFromStore(
  state: Pick<ReposStore, 'sessionReady'>,
): LocalWorkspaceSessionState {
  return {
    sessionReady: state.sessionReady,
  }
}

export function localWorkspaceSearchStateFromStore(
  state: Pick<ReposStore, 'branchSearchQueries'>,
): LocalWorkspaceSearchState {
  return {
    branchSearchQueries: state.branchSearchQueries,
  }
}

export function mainWindowWorkspaceStateFromStore(
  state: Pick<
    ReposStore,
    'activeId' | 'order' | 'detailCollapsed' | 'detailFocusMode' | 'workspaceLayout' | 'sessionReady'
  >,
): MainWindowWorkspaceState {
  const restorable = restorableWorkspaceViewportStateFromStore(state)
  const local = localWorkspaceSessionStateFromStore({ sessionReady: state.sessionReady })
  return {
    activeId: restorable.activeId,
    order: restorable.order,
    detailCollapsed: restorable.detailCollapsed,
    detailFocusMode: restorable.detailFocusMode,
    workspaceLayout: restorable.workspaceLayout,
    sessionReady: local.sessionReady,
  }
}

export function navigationWorkspaceStateFromStore(
  state: Pick<ReposStore, 'activeId' | 'order'>,
): MainWindowNavigationState {
  const restorable = restorableWorkspaceNavigationStateFromStore(state)
  return {
    activeId: restorable.activeId,
    order: restorable.order,
  }
}

export function mainWindowWorkspaceStateEqual(a: MainWindowWorkspaceState, b: MainWindowWorkspaceState): boolean {
  return (
    a.activeId === b.activeId &&
    a.detailCollapsed === b.detailCollapsed &&
    a.detailFocusMode === b.detailFocusMode &&
    a.workspaceLayout === b.workspaceLayout &&
    a.sessionReady === b.sessionReady &&
    arraysEqual(a.order, b.order)
  )
}

export function navigationWorkspaceStateEqual(a: MainWindowNavigationState, b: MainWindowNavigationState): boolean {
  return a.activeId === b.activeId && arraysEqual(a.order, b.order)
}

export function activeRepoFromStore(state: Pick<ReposStore, 'activeId' | 'repos'>): RepoState | null {
  const activeId = state.activeId
  if (!activeId) return null
  return runtimeCoherentRepoProjectionStateFromStore({ repos: state.repos }).repos[activeId] ?? null
}

export function keyboardRuntimeStateFromStore(
  state: Pick<ReposStore, 'detailCollapsed' | 'repos' | 'branchSearchQueries'>,
  currentRepoId: string | null,
): KeyboardRuntimeState {
  const runtimeCoherent = runtimeCoherentRepoProjectionStateFromStore({ repos: state.repos })
  const restorable = restorableWorkspaceViewportStateFromStore({
    activeId: null,
    order: [],
    detailCollapsed: state.detailCollapsed,
    detailFocusMode: false,
    workspaceLayout: 'top-bottom',
  })
  const local = localWorkspaceSearchStateFromStore({ branchSearchQueries: state.branchSearchQueries })
  const repo = currentRepoId ? (runtimeCoherent.repos[currentRepoId] ?? null) : null
  return {
    detailCollapsed: restorable.detailCollapsed,
    repo,
    searchQuery: repo ? (local.branchSearchQueries[repo.id] ?? '') : '',
  }
}

function arraysEqual<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}
