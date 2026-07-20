import type { GitWorkspaceProjection, WorkspaceState } from '#/web/stores/workspaces/types.ts'

export interface GitWorkspaceState extends WorkspaceState {
  capability: Extract<WorkspaceState['capability'], { kind: 'git' }>
}

export function isGitWorkspace(workspace: WorkspaceState): workspace is GitWorkspaceState {
  return workspace.capability.kind === 'git'
}

export function gitWorkspaceProjection(workspace: GitWorkspaceState): GitWorkspaceProjection {
  return workspace.capability.git
}

export function requireGitWorkspaceProjection(workspace: WorkspaceState): GitWorkspaceProjection {
  if (!isGitWorkspace(workspace)) throw new Error(`Workspace is not Git-capable: ${workspace.id}`)
  return workspace.capability.git
}
