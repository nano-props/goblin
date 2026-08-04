import { ensureRepoSnapshotReadModel, refreshRepoSnapshotReadModel } from '#/web/repo-query-runtime.ts'
import { appendRepoEvent, errorEvent } from '#/web/stores/workspaces/workspace-state-factory.ts'
import { resolveActionWorkspaceRuntimeId } from '#/web/stores/workspaces/refresh-state.ts'
import { updateIfFresh } from '#/web/stores/workspaces/workspace-guards.ts'
import { gitWorkspaceClientState, isGitWorkspace } from '#/web/stores/workspaces/git-workspace-client-state.ts'
import type { WorkspacesGet, WorkspacesSet } from '#/web/stores/workspaces/types.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

export interface RepoRefreshStoreReader {
  get: WorkspacesGet
}

export interface RepoRefreshStoreAccess extends RepoRefreshStoreReader {
  set: WorkspacesSet
}

export async function requestRepoSnapshotRefresh(
  store: RepoRefreshStoreAccess,
  id: WorkspaceId,
  options?: { workspaceRuntimeId?: string; signal?: AbortSignal },
): Promise<void> {
  const resolved = resolveActionWorkspaceRuntimeId(store.get, id, options?.workspaceRuntimeId)
  if (!resolved) return
  try {
    await refreshRepoSnapshotReadModel(id, resolved.workspaceRuntimeId, { signal: options?.signal })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    updateIfFresh(store.set, id, resolved.workspaceRuntimeId, (workspace) => {
      if (!isGitWorkspace(workspace)) return
      const git = gitWorkspaceClientState(workspace)
      git.events = appendRepoEvent(git.events, errorEvent(message))
    })
  }
}

export async function requestInitialRepoSnapshotLoad(
  store: RepoRefreshStoreAccess,
  id: WorkspaceId,
  options?: { workspaceRuntimeId?: string; signal?: AbortSignal },
): Promise<void> {
  const resolved = resolveActionWorkspaceRuntimeId(store.get, id, options?.workspaceRuntimeId)
  if (!resolved) return
  try {
    await ensureRepoSnapshotReadModel(id, resolved.workspaceRuntimeId, { signal: options?.signal })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    updateIfFresh(store.set, id, resolved.workspaceRuntimeId, (workspace) => {
      if (!isGitWorkspace(workspace)) return
      const git = gitWorkspaceClientState(workspace)
      git.events = appendRepoEvent(git.events, errorEvent(message))
    })
  }
}
