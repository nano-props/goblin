import { appendRepoEvent, errorEvent } from '#/web/stores/workspaces/workspace-state-factory.ts'
import { acceptWorkspaceProbeState, updateIfFresh } from '#/web/stores/workspaces/workspace-guards.ts'
import { isRepoUnavailableReason, markRepoUnavailable } from '#/web/stores/workspaces/availability.ts'
import { runExclusiveOperation, runLatestOperation } from '#/web/stores/workspaces/operation-runner.ts'
import { resolveActionWorkspaceRuntimeId } from '#/web/stores/workspaces/refresh-state.ts'
import { createRefreshSyncHelpers } from '#/web/stores/workspaces/refresh-sync.ts'
import { cancelDataLoad, finishDataLoadError, startDataLoad } from '#/web/stores/workspaces/repo-data-load-state.ts'
import { refreshRepoProjectionReadModel } from '#/web/repo-data-query.ts'
import { readRepoBranchSnapshotQueryProjection } from '#/web/repo-branch-read-model.ts'
import { acceptRepoProjectionReadModel } from '#/web/stores/workspaces/projection-read-model-effects.ts'
import { refreshRepoWorktreeStatus } from '#/web/stores/workspaces/worktree-status-refresh.ts'
import type { WorkspaceRuntimeProjection } from '#/shared/api-types.ts'
import type { WorkspacesGet, WorkspacesSet } from '#/web/stores/workspaces/types.ts'
import { refreshWorkspace } from '#/web/workspace-client.ts'
import { gitWorkspaceProjection, isGitWorkspace } from '#/web/stores/workspaces/git-workspace-projection.ts'

export interface RepoRefreshStoreAccess {
  set: WorkspacesSet
  get: WorkspacesGet
}

async function runRepoProjectionReadModelRefresh(
  store: RepoRefreshStoreAccess,
  id: string,
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
    onResult: (projection: WorkspaceRuntimeProjection, ctx) => {
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
        if (isRepoUnavailableReason(message)) markRepoUnavailable(r, message)
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
  id: string,
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

/** Unified sync pipeline — local and remote repos follow the same path.
 *  1) Attempt a best-effort fetch when remotes are configured.
 *  2) Always refresh the server runtime projection afterwards.
 *  Bookkeeping (setLastResult, clearFetchFailed) is handled inline
 *  so there is one source of truth for post-sync cleanup. */
export async function runManualRepoSync(
  store: RepoRefreshStoreAccess,
  id: string,
  options?: { workspaceRuntimeId?: string },
): Promise<void> {
  const resolved = resolveActionWorkspaceRuntimeId(store.get, id, options?.workspaceRuntimeId)
  if (!resolved || !isGitWorkspace(resolved.repo)) return
  const { workspaceRuntimeId } = resolved
  const { runManualSyncPipeline } = createRefreshSyncHelpers(store.set, store.get, {
    refreshProjectionReadModel: async (repoId, nextWorkspaceRuntimeId) => {
      await requestRepoProjectionReadModelRefresh(store, repoId, { workspaceRuntimeId: nextWorkspaceRuntimeId })
    },
  })
  await runExclusiveOperation({
    set: store.set,
    get: store.get,
    id,
    workspaceRuntimeId,
    lane: 'read',
    priority: 100,
    targets: [{ key: 'manualRefresh', reason: 'manual-refresh' }],
    task: async (signal) => {
      const refreshed = await refreshWorkspace(id, workspaceRuntimeId, signal)
      if (refreshed.kind === 'stale-runtime') throw new Error('error.workspace-runtime-stale')
      if (refreshed.kind === 'failed') {
        const diagnostic = refreshed.probe.status === 'ready' ? refreshed.probe.diagnostics[0]?.message : undefined
        throw new Error(diagnostic ?? 'error.failed-read-repo')
      }
      updateIfFresh(store.set, id, workspaceRuntimeId, (repo) => {
        acceptWorkspaceProbeState(repo, refreshed.probe)
      })
      if (
        refreshed.probe.status === 'ready' &&
        refreshed.probe.capabilities.git.status === 'unavailable'
      ) {
        return
      }
      await runManualSyncPipeline(id, workspaceRuntimeId)
    },
    onError: (message) => {
      updateIfFresh(store.set, id, workspaceRuntimeId, (repo) => {
        if (!isGitWorkspace(repo)) return
        const git = gitWorkspaceProjection(repo)
        git.events = appendRepoEvent(git.events, errorEvent(message))
      })
    },
  })
}
