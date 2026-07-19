import type {
  WorkspaceState,
  WorkspacesStore,
  RestorableWorkspaceState,
  RuntimeCoherentWorkspaceState,
} from '#/web/stores/workspaces/types.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

export type WorkspaceRestoreStatus = 'restoring-membership' | 'restoring-runtime-state' | 'ready' | 'blocked'

interface KeyboardRuntimeState {
  workspace: WorkspaceState | null
}

export function runtimeCoherentWorkspaceStateFromStore(
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
  currentWorkspaceId: WorkspaceId | null,
): KeyboardRuntimeState {
  const workspace = currentWorkspaceId ? (state.workspaces[currentWorkspaceId] ?? null) : null
  return {
    workspace,
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
