import type { RemoteWorkspaceFailureReason, RemoteWorkspaceTarget } from '#/shared/remote-workspace.ts'
import type { WorkspaceState } from '#/web/stores/workspaces/types.ts'

type RemoteWorkspaceAdmissionTarget = Pick<WorkspaceState, 'admission'>

export function markRemoteLifecycleConnecting(workspace: RemoteWorkspaceAdmissionTarget): void {
  remoteWorkspaceAdmission(workspace).lifecycle = { kind: 'connecting' }
}

export function markRemoteLifecycleReady(
  workspace: RemoteWorkspaceAdmissionTarget,
  target: RemoteWorkspaceTarget,
): void {
  remoteWorkspaceAdmission(workspace).lifecycle = { kind: 'ready', target }
}

export function markRemoteLifecycleFailed(
  workspace: RemoteWorkspaceAdmissionTarget,
  reason: RemoteWorkspaceFailureReason,
  target?: RemoteWorkspaceTarget,
): void {
  remoteWorkspaceAdmission(workspace).lifecycle = target
    ? { kind: 'failed', reason, target }
    : { kind: 'failed', reason }
}

function remoteWorkspaceAdmission(
  workspace: RemoteWorkspaceAdmissionTarget,
): Extract<WorkspaceState['admission'], { kind: 'remote' }> {
  if (workspace.admission.kind !== 'remote')
    throw new Error('Remote lifecycle requires remote workspace admission')
  return workspace.admission
}
