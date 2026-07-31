import type {
  WorkspaceState,
  RestorableWorkspaceState,
  RuntimeCoherentWorkspaceState,
} from '#/web/stores/workspaces/types.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

export type WorkspaceRestoreStatus = 'restoring-membership' | 'restoring-runtime-state' | 'ready' | 'blocked'

interface KeyboardRuntimeState {
  workspace: WorkspaceState | null
}

interface WorkspaceRestoreProgressState {
  workspaceMembershipReady: boolean
  sessionPersistenceReady: boolean
  sessionRestoreError: string | null
}

export function runtimeCoherentWorkspaceStateFromStore(
  state: RuntimeCoherentWorkspaceState,
): RuntimeCoherentWorkspaceState {
  return {
    workspaces: state.workspaces,
  }
}

export function restorableWorkspaceStateFromStore(state: RestorableWorkspaceState): RestorableWorkspaceState {
  return {
    workspaceOrder: state.workspaceOrder,
    restoredWorkspaceId: state.restoredWorkspaceId,
    zenMode: state.zenMode,
    workspacePaneSize: state.workspacePaneSize,
    selectedTerminalSessionIdByTerminalFilesystemTarget: state.selectedTerminalSessionIdByTerminalFilesystemTarget,
    branchViewModeByWorkspace: state.branchViewModeByWorkspace,
  }
}

export function keyboardRuntimeStateFromStore(
  state: RuntimeCoherentWorkspaceState,
  currentWorkspaceId: WorkspaceId | null,
): KeyboardRuntimeState {
  const workspace = currentWorkspaceId ? (state.workspaces[currentWorkspaceId] ?? null) : null
  return {
    workspace,
  }
}

export function workspaceRestoreStatusFromStore(state: WorkspaceRestoreProgressState): WorkspaceRestoreStatus {
  if (!state.workspaceMembershipReady) return 'restoring-membership'
  if (state.sessionRestoreError) return 'blocked'
  if (!state.sessionPersistenceReady) return 'restoring-runtime-state'
  return 'ready'
}

export function workspaceSessionPersistenceOpenFromStore(state: WorkspaceRestoreProgressState): boolean {
  return workspaceRestoreStatusFromStore(state) === 'ready'
}
