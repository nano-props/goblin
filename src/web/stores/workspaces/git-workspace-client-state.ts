import type { GitWorkspaceClientState, WorkspaceState } from '#/web/stores/workspaces/types.ts'

export interface GitWorkspaceState extends WorkspaceState {
  capability: Extract<WorkspaceState['capability'], { kind: 'git' }>
}

export function isGitWorkspace(workspace: WorkspaceState): workspace is GitWorkspaceState {
  return workspace.capability.kind === 'git'
}

export function gitWorkspaceClientState(workspace: GitWorkspaceState): GitWorkspaceClientState {
  return workspace.capability.git
}

export function requireGitWorkspaceClientState(workspace: WorkspaceState): GitWorkspaceClientState {
  if (!isGitWorkspace(workspace)) throw new Error(`Workspace is not Git-capable: ${workspace.id}`)
  return workspace.capability.git
}
