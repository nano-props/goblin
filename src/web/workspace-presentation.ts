import type { WorkspaceState } from '#/web/stores/workspaces/types.ts'
import { dataLoadInitialLoading } from '#/web/stores/workspaces/repo-data-load-state.ts'
import { deriveWorkspaceConnectivity } from '#/web/stores/workspaces/workspace-guards.ts'

export interface WorkspacePresentation {
  exists: boolean
  initialLoading: boolean
}

export function getWorkspacePresentation(workspace: WorkspaceState | undefined): WorkspacePresentation {
  if (!workspace) return { exists: false, initialLoading: false }
  if (workspace.capability.kind !== 'git') return { exists: true, initialLoading: false }

  const remoteConnecting = deriveWorkspaceConnectivity(workspace) === 'connecting'
  const hasLoadedReadModel = workspace.capability.git.dataLoads.repoReadModel.loadedAt !== null
  return {
    exists: true,
    initialLoading:
      dataLoadInitialLoading(workspace.capability.git.dataLoads.repoReadModel) ||
      (remoteConnecting && !hasLoadedReadModel),
  }
}
