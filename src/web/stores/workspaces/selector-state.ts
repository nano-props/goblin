import type {
  WorkspaceState,
  WorkspacesStore,
  RestorableWorkspaceState,
  RuntimeCoherentWorkspaceState,
} from '#/web/stores/workspaces/types.ts'

export type WorkspaceRestoreStatus = 'restoring-membership' | 'restoring-runtime-state' | 'ready' | 'blocked'

interface KeyboardRuntimeState {
  repo: WorkspaceState | null
}

export function runtimeCoherentRepoProjectionStateFromStore(
  state: Pick<WorkspacesStore, 'workspaces'>,
): RuntimeCoherentWorkspaceState {
  return {
    workspaces: state.workspaces,
  }
}

export function restorableWorkspaceStateFromStore(
  state: Pick<
    WorkspacesStore,
    | 'workspaceOrder'
    | 'restoredWorkspaceId'
    | 'zenMode'
    | 'workspacePaneSize'
    | 'selectedTerminalSessionIdByTerminalWorktree'
  >,
): RestorableWorkspaceState {
  return {
    workspaceOrder: state.workspaceOrder,
    restoredWorkspaceId: state.restoredWorkspaceId,
    zenMode: state.zenMode,
    workspacePaneSize: state.workspacePaneSize,
    selectedTerminalSessionIdByTerminalWorktree: state.selectedTerminalSessionIdByTerminalWorktree,
  }
}

export function keyboardRuntimeStateFromStore(
  state: Pick<WorkspacesStore, 'workspaces'>,
  currentRepoId: string | null,
): KeyboardRuntimeState {
  const repo = currentRepoId ? (state.workspaces[currentRepoId] ?? null) : null
  return {
    repo,
  }
}

export function workspaceRestoreStatusFromStore(
  state: Pick<WorkspacesStore, 'workspaceMembershipReady' | 'sessionPersistenceReady' | 'sessionRestoreError'>,
): WorkspaceRestoreStatus {
  if (!state.workspaceMembershipReady) return 'restoring-membership'
  if (state.sessionRestoreError) return 'blocked'
  if (!state.sessionPersistenceReady) return 'restoring-runtime-state'
  return 'ready'
}

export function workspaceSessionPersistenceOpenFromStore(
  state: Pick<WorkspacesStore, 'workspaceMembershipReady' | 'sessionPersistenceReady' | 'sessionRestoreError'>,
): boolean {
  return workspaceRestoreStatusFromStore(state) === 'ready'
}
