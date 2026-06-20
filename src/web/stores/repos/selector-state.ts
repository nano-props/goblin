import type {
  RepoState,
  ReposStore,
  RestorableWorkspaceState,
  RuntimeCoherentRepoProjectionState,
} from '#/web/stores/repos/types.ts'

export interface MainWindowWorkspaceState extends Pick<
  ReposStore,
  'activeId' | 'order' | 'workspacePaneFocusMode' | 'sessionReady'
> {}

export interface MainWindowNavigationState extends Pick<ReposStore, 'activeId' | 'order'> {}

export interface KeyboardRuntimeState {
  repo: RepoState | null
}

export interface RestorableWorkspaceViewportState extends Pick<
  ReposStore,
  'activeId' | 'order' | 'workspacePaneFocusMode'
> {}

export interface RestorableWorkspaceNavigationState extends Pick<ReposStore, 'activeId' | 'order'> {}

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
    | 'workspacePaneFocusMode'
    | 'workspacePaneSizes'
    | 'selectedTerminalByWorktree'
    | 'workspacePaneViewByRepo'
  >,
): RestorableWorkspaceState {
  return {
    order: state.order,
    activeId: state.activeId,
    workspacePaneFocusMode: state.workspacePaneFocusMode,
    workspacePaneSizes: state.workspacePaneSizes,
    selectedTerminalByWorktree: state.selectedTerminalByWorktree,
    workspacePaneViewByRepo: state.workspacePaneViewByRepo ?? {},
  }
}

function restorableWorkspaceViewportStateFromStore(
  state: Pick<ReposStore, 'activeId' | 'order' | 'workspacePaneFocusMode'>,
): RestorableWorkspaceViewportState {
  return {
    activeId: state.activeId,
    order: state.order,
    workspacePaneFocusMode: state.workspacePaneFocusMode,
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

export function mainWindowWorkspaceStateFromStore(
  state: Pick<ReposStore, 'activeId' | 'order' | 'workspacePaneFocusMode' | 'sessionReady'>,
): MainWindowWorkspaceState {
  const restorable = restorableWorkspaceViewportStateFromStore(state)
  return {
    activeId: restorable.activeId,
    order: restorable.order,
    workspacePaneFocusMode: restorable.workspacePaneFocusMode,
    sessionReady: state.sessionReady,
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
    a.workspacePaneFocusMode === b.workspacePaneFocusMode &&
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
  state: Pick<ReposStore, 'repos'>,
  currentRepoId: string | null,
): KeyboardRuntimeState {
  const repo = currentRepoId ? (state.repos[currentRepoId] ?? null) : null
  return {
    repo,
  }
}

function arraysEqual<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}
