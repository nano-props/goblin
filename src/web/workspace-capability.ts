import type { GitWorkspaceProjection, WorkspaceAdmissionState, WorkspaceState } from '#/web/stores/workspaces/types.ts'

export function workspaceGitProjection(workspace: WorkspaceState | null | undefined): GitWorkspaceProjection | null {
  return workspace?.capability.kind === 'git' ? workspace.capability.git : null
}

export function workspaceRemoteAdmission(
  workspace: WorkspaceState | null | undefined,
): Extract<WorkspaceAdmissionState, { kind: 'remote' }> | null {
  return workspace?.admission.kind === 'remote' ? workspace.admission : null
}
