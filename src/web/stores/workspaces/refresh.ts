import { appendRepoEvent, errorEvent } from '#/web/stores/workspaces/workspace-state-factory.ts'
import { updateIfFresh } from '#/web/stores/workspaces/workspace-guards.ts'
import { runLatestOperation } from '#/web/stores/workspaces/operation-runner.ts'
import { resolveActionWorkspaceRuntimeId } from '#/web/stores/workspaces/refresh-state.ts'
import { cancelDataLoad, finishDataLoadError, startDataLoad } from '#/web/stores/workspaces/repo-data-load-state.ts'
import { refreshRepoProjectionReadModel } from '#/web/repo-data-query.ts'
import { readRepoBranchSnapshotQueryProjection } from '#/web/repo-branch-read-model.ts'
import { acceptRepoProjectionReadModel } from '#/web/stores/workspaces/projection-read-model-effects.ts'
import { refreshRepoWorktreeStatus } from '#/web/stores/workspaces/worktree-status-refresh.ts'
import type { GitWorkspaceRuntimeProjection } from '#/shared/api-types.ts'
import type { WorkspacesGet, WorkspacesSet } from '#/web/stores/workspaces/types.ts'
import { gitWorkspaceProjection, isGitWorkspace } from '#/web/stores/workspaces/git-workspace-projection.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

export interface RepoRefreshStoreAccess {
  set: WorkspacesSet
  get: WorkspacesGet
}

async function runRepoProjectionReadModelRefresh(
  store: RepoRefreshStoreAccess,
  id: WorkspaceId,
  workspaceRuntimeId: string,
): Promise<void> {
  updateIfFresh(store.set, id, workspaceRuntimeId, (r) => {
    if (!isGitWorkspace(r)) return
    startDataLoad(gitWorkspaceProjection(r).dataLoads.repoReadModel, {
      hasData: (readRepoBranchSnapshotQueryProjection(r)?.branches.length ?? 0) > 0,
    })
  })
  await runLatestOperation({
    set: store.set,
    get: store.get,
    id,
    workspaceRuntimeId,
    lane: 'read',
    operationKey: 'repo-read-model',
    priority: 50,
    targets: [{ key: 'repoReadModel', reason: 'repo-read-model' }],
    task: (signal) => refreshRepoProjectionReadModel(id, workspaceRuntimeId, null, 'full', { signal }),
    errorFromResult: (projection) => (projection.snapshot ? null : 'error.failed-read-repo'),
    onResult: (projection: GitWorkspaceRuntimeProjection, ctx) => {
      if (!ctx.isCurrent()) return
      acceptRepoProjectionReadModel(
        store.set,
        store.get,
        { repoRoot: id, workspaceRuntimeId, projection },
        { scope: 'repo-read-model' },
      )
    },
    onError: (message, ctx) => {
      const ownsReadModelLoad = ctx.ownsTarget('repoReadModel')
      updateIfFresh(store.set, id, workspaceRuntimeId, (r) => {
        if (!isGitWorkspace(r)) return
        const git = gitWorkspaceProjection(r)
        if (ownsReadModelLoad) finishDataLoadError(git.dataLoads.repoReadModel, message)
        git.events = appendRepoEvent(git.events, errorEvent(message))
      })
    },
    onStale: (ctx) => {
      const ownsReadModelLoad = ctx.ownsTarget('repoReadModel')
      if (!ownsReadModelLoad) return
      updateIfFresh(store.set, id, workspaceRuntimeId, (r) => {
        if (!isGitWorkspace(r)) return
        if (ownsReadModelLoad) cancelDataLoad(gitWorkspaceProjection(r).dataLoads.repoReadModel)
      })
    },
  })
}

export async function requestRepoProjectionReadModelRefresh(
  store: RepoRefreshStoreAccess,
  id: WorkspaceId,
  options?: { workspaceRuntimeId?: string },
): Promise<void> {
  const resolved = resolveActionWorkspaceRuntimeId(store.get, id, options?.workspaceRuntimeId)
  if (!resolved || !isGitWorkspace(resolved.repo)) return
  const { workspaceRuntimeId } = resolved
  await Promise.all([
    runRepoProjectionReadModelRefresh(store, id, workspaceRuntimeId),
    refreshRepoWorktreeStatus(store, id, workspaceRuntimeId),
  ])
}
