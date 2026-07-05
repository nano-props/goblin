import type { RepoState, ReposStore, RestorableWorkspaceState, RuntimeCoherentRepoProjectionState } from '#/web/stores/repos/types.ts'

interface KeyboardRuntimeState {
  repo: RepoState | null
}

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
    'order' | 'restoredRepoId' | 'zenMode' | 'workspacePaneSize' | 'selectedTerminalSessionIdByTerminalWorktree'
  >,
): RestorableWorkspaceState {
  return {
    order: state.order,
    restoredRepoId: state.restoredRepoId,
    zenMode: state.zenMode,
    workspacePaneSize: state.workspacePaneSize,
    selectedTerminalSessionIdByTerminalWorktree: state.selectedTerminalSessionIdByTerminalWorktree,
  }
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
