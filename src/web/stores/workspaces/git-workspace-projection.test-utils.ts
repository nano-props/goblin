import type { WorkspaceState } from '#/web/stores/workspaces/types.ts'
import { isGitWorkspace, type GitWorkspaceState } from '#/web/stores/workspaces/git-workspace-projection.ts'

export function requireGitWorkspaceForTest(workspace: WorkspaceState | undefined): GitWorkspaceState {
  if (!workspace || !isGitWorkspace(workspace)) throw new Error('expected Git workspace capability')
  return workspace
}

export function requireRemoteAdmissionForTest(
  workspace: WorkspaceState | undefined,
): Extract<WorkspaceState['admission'], { kind: 'remote' }> {
  if (!workspace || workspace.admission.kind !== 'remote') throw new Error('expected remote workspace admission')
  return workspace.admission
}
