import type { WorkspaceState } from '#/web/stores/workspaces/types.ts'

export interface WorkspacePresentation {
  exists: boolean
  initialLoading: boolean
}

export function getWorkspacePresentation(workspace: WorkspaceState | undefined): WorkspacePresentation {
  if (!workspace) return { exists: false, initialLoading: false }
  return { exists: true, initialLoading: false }
}
