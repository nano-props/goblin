import { appendRepoEvent, errorEvent } from '#/web/stores/repos/repo-state-factory.ts'
import { updateIfFresh } from '#/web/stores/repos/repo-guards.ts'
import { refreshPullRequestsLog, refreshStatusLog } from '#/web/logger.ts'
import { isRemoteRepoId } from '#/shared/remote-repo.ts'
import { isRepoUnavailableReason, markRepoUnavailable } from '#/web/stores/repos/availability.ts'
import { runExclusiveOperation, runLatestOperation } from '#/web/stores/repos/operation-runner.ts'
import { persistRepoSnapshotCacheEntry } from '#/web/stores/repos/persistence.ts'
import { runLatestDataLoadOperation } from '#/web/stores/repos/data-load-runner.ts'
import { applyStatusToWorktreeStates } from '#/web/stores/repos/worktree-state.ts'
import { pruneRepoBranchPullRequestOperations } from '#/web/stores/repos/repo-operation-scheduler.ts'
import { runCoreDataRefreshWorkflow, runSnapshotSuccessWorkflow } from '#/web/stores/repos/refresh-workflows.ts'
import {
  applyPullRequestRefreshErrorState,
  applyPullRequestRefreshStaleState,
  applyPullRequestRefreshSuccessState,
  applyPullRequestRefreshUnavailableState,
  applySnapshotToRepoProjection,
  resolveActionRepoInstanceId,
  startPullRequestRefreshDataLoads,
} from '#/web/stores/repos/refresh-state.ts'
import { createRefreshSyncHelpers } from '#/web/stores/repos/refresh-sync.ts'
import { runWithRepoInvalidationSource } from '#/web/stores/repos/invalidation-sources.ts'
import { finishDataLoadError, finishDataLoadSuccess, startDataLoad } from '#/web/stores/repos/repo-data-load-state.ts'
import { getRepoPullRequests, getRepoSnapshot, getRepoStatus, readRepoBulk } from '#/web/repo-client.ts'
import {
  setRepoBulkReadQueryData,
  setRepoPullRequestsQueryData,
  setRepoSnapshotQueryData,
  setRepoStatusQueryData,
} from '#/web/repo-data-query.ts'
import { readRepoBranches } from '#/web/repo-branch-read-model.ts'
import type { RepoSnapshot } from '#/shared/api-types.ts'
import type { RepoPullRequestReason } from '#/web/stores/repos/operations.ts'
import type { RepoState, ReposGet, ReposSet } from '#/web/stores/repos/types.ts'
import type { PullRequestFetchMode, PullRequestInfo } from '#/web/types.ts'

function resolvePullRequestRefreshRequest(
  repo: Pick<RepoState, 'id' | 'instanceId' | 'availability' | 'data' | 'remote'>,
  branchesArg?: string[],
  options?: {
    mode?: PullRequestFetchMode
    clearMissing?: boolean
  },
): {
  branchNames: string[]
  requested: Set<string>
  mode: PullRequestFetchMode
  clearMissing: boolean
} | null {
  // Phase 4: inlined because the caller is a `Pick<RepoState>`
  // and `isRepoUnavailable` wants a full repo (it reads `id`).
  // Local repos carry their failure in `availability.phase`;
  // remote repos carry theirs in `remote.lifecycle.kind`.
  if (isRemoteRepoId(repo.id)) {
    if (repo.remote.lifecycle?.kind === 'failed') return null
  } else if (repo.availability.phase === 'unavailable') {
    return null
  }
  const mode = options?.mode ?? 'full'
  const clearMissing = options?.clearMissing ?? mode === 'full'
  const branchNames = branchesArg ?? readRepoBranches(repo).map((branch) => branch.name)
  if (branchNames.length === 0) return null
  if (repo.remote.hasGitHubRemote !== true) return null
  return { branchNames, requested: new Set(branchNames), mode, clearMissing }
}

export function createRefreshActions(set: ReposSet, get: ReposGet) {
  const { runManualSyncPipeline } = createRefreshSyncHelpers(set, get)

  function pullRequestReason(mode: PullRequestFetchMode): RepoPullRequestReason {
    switch (mode) {
      case 'summary':
        return 'summary'
      case 'full':
        return 'full'
    }
    const exhaustive: never = mode
    return exhaustive
  }

  async function runSnapshotSuccessFlow(
    id: string,
    repoInstanceId: string,
    snap: RepoSnapshot,
    isSnapshotCurrent: () => boolean,
    options?: { skipLogBackfill?: boolean },
  ): Promise<void> {
    const validBranches = new Set(snap.branches.map((b) => b.name))
    updateIfFresh(set, id, repoInstanceId, (r) => {
      applySnapshotToRepoProjection(r, snap, validBranches)
    })
    pruneRepoBranchPullRequestOperations(id, validBranches)
    const branchNames = snap.branches.map((branch) => branch.name)
    const worktreePaths = snap.branches
      .map((branch) => branch.worktree?.path)
      .filter((p): p is string => typeof p === 'string' && p.length > 0)
    await runSnapshotSuccessWorkflow(set, get, {
      id,
      repoInstanceId,
      branchNames,
      worktreePaths,
      isSnapshotCurrent,
      skipLogBackfill: options?.skipLogBackfill,
    })
  }

  function applyPullRequestRefreshUnavailable(
    id: string,
    repoInstanceId: string,
    branchNames: string[],
    mode: PullRequestFetchMode,
  ): void {
    updateIfFresh(set, id, repoInstanceId, (r) => {
      applyPullRequestRefreshUnavailableState(r, branchNames, mode)
    })
  }

  function applyPullRequestRefreshSuccess(
    id: string,
    repoInstanceId: string,
    branchNames: string[],
    entries: Array<{ branch: string; pullRequest: PullRequestInfo }>,
    requested: Set<string>,
    clearMissing: boolean,
    mode: PullRequestFetchMode,
  ): void {
    updateIfFresh(set, id, repoInstanceId, (r) => {
      applyPullRequestRefreshSuccessState(r, branchNames, entries, requested, clearMissing, mode)
    })
  }

  function applyPullRequestRefreshStale(
    id: string,
    repoInstanceId: string,
    branchNames: string[],
    mode: PullRequestFetchMode,
    operationId: number,
  ): void {
    updateIfFresh(set, id, repoInstanceId, (r) => {
      applyPullRequestRefreshStaleState(r, branchNames, mode, operationId)
    })
  }

  function applyPullRequestRefreshError(
    id: string,
    repoInstanceId: string,
    branchNames: string[],
    mode: PullRequestFetchMode,
    err: unknown,
  ): void {
    const message = err instanceof Error ? err.message : String(err)
    refreshPullRequestsLog.warn('failed', { err })
    updateIfFresh(set, id, repoInstanceId, (r) => {
      applyPullRequestRefreshErrorState(r, branchNames, mode, message)
      r.events = appendRepoEvent(r.events, errorEvent(message))
    })
  }

  return {
    async refreshSnapshot(id: string, options?: { skipLogBackfill?: boolean; repoInstanceId?: string }) {
      const resolved = resolveActionRepoInstanceId(get, id, options?.repoInstanceId)
      if (!resolved) return
      const { repoInstanceId } = resolved
      updateIfFresh(set, id, repoInstanceId, (r) => {
        startDataLoad(r.dataLoads.snapshot, { hasData: r.data.branches.length > 0 })
      })
      await runLatestOperation({
        set,
        get,
        id,
        repoInstanceId,
        lane: 'read',
        operationKey: 'snapshot',
        priority: 50,
        targets: [{ key: 'snapshot', reason: 'snapshot' }],
        task: (signal) => getRepoSnapshot(id, signal),
        errorFromResult: (snap) => (snap ? null : 'error.failed-read-repo'),
        onResult: async (snap, ctx) => {
          if (ctx.isCurrent()) setRepoSnapshotQueryData(id, repoInstanceId, snap)
          if (!snap) {
            updateIfFresh(set, id, repoInstanceId, (r) => {
              finishDataLoadError(r.dataLoads.snapshot, 'error.failed-read-repo')
              r.events = appendRepoEvent(r.events, errorEvent('error.failed-read-repo'))
            })
            return
          }
          await runSnapshotSuccessFlow(id, repoInstanceId, snap, ctx.isCurrent, { skipLogBackfill: options?.skipLogBackfill })
        },
        onError: (message) => {
          updateIfFresh(set, id, repoInstanceId, (r) => {
            if (isRepoUnavailableReason(message)) markRepoUnavailable(r, message)
            finishDataLoadError(r.dataLoads.snapshot, message)
            r.events = appendRepoEvent(r.events, errorEvent(message))
          })
        },
      })
    },

    async refreshPullRequests(
      id: string,
      branchesArg?: string[],
      options?: {
        repoInstanceId?: string
        mode?: PullRequestFetchMode
        clearMissing?: boolean
      },
    ) {
      const resolved = resolveActionRepoInstanceId(get, id, options?.repoInstanceId)
      if (!resolved) return
      const { repo: repoBefore, repoInstanceId } = resolved
      const request = resolvePullRequestRefreshRequest(repoBefore, branchesArg, options)
      if (!request) return
      const { branchNames, requested, mode, clearMissing } = request
      updateIfFresh(set, id, repoInstanceId, (r) => {
        startPullRequestRefreshDataLoads(r, branchNames, requested, mode)
      })
      await runLatestOperation({
        set,
        get,
        id,
        repoInstanceId,
        lane: 'read',
        operationKey: 'pullRequests',
        priority: 10,
        targets: [
          { key: 'pullRequests', reason: pullRequestReason(mode) },
          ...branchNames.map((branch) => ({ key: `pullRequest:${branch}` as const, reason: pullRequestReason(mode) })),
        ],
        task: (signal) => getRepoPullRequests(id, branchNames, { mode }, signal),
        onResult: (entries, ctx) => {
          if (ctx.isCurrent()) setRepoPullRequestsQueryData(id, repoInstanceId, branchNames, mode, entries)
          if (entries === null) {
            applyPullRequestRefreshUnavailable(id, repoInstanceId, branchNames, mode)
            return
          }
          applyPullRequestRefreshSuccess(id, repoInstanceId, branchNames, entries, requested, clearMissing, mode)
          if (ctx.isCurrent()) persistRepoSnapshotCacheEntry(set, get().repos[id], repoInstanceId)
        },
        onStale: (ctx) => {
          applyPullRequestRefreshStale(id, repoInstanceId, branchNames, mode, ctx.operationId)
        },
        onError: (message) => {
          applyPullRequestRefreshError(id, repoInstanceId, branchNames, mode, message)
        },
      })
    },

    async refreshStatus(id: string, options?: { repoInstanceId?: string }) {
      const resolved = resolveActionRepoInstanceId(get, id, options?.repoInstanceId)
      if (!resolved) return
      const { repoInstanceId } = resolved
      await runLatestDataLoadOperation({
        set,
        get,
        id,
        repoInstanceId,
        lane: 'read',
        operationKey: 'status',
        priority: 40,
        target: { key: 'status', reason: 'status' },
        selectDataLoad: (r) => r.dataLoads.status,
        start: (r) => ({ hasData: r.data.statusLoaded || r.data.status.length > 0 }),
        task: (signal) => getRepoStatus(id, signal),
        applyResult: (r, status) => {
          r.data.status = status
          r.data.statusLoaded = true
          r.data.worktreesByPath = applyStatusToWorktreeStates(r.data.worktreesByPath, status)
        },
        onSuccess: (_status, ctx) => {
          if (ctx.isCurrent()) setRepoStatusQueryData(id, repoInstanceId, _status)
          const repoAfterStatus = get().repos[id]
          if (ctx.isCurrent()) persistRepoSnapshotCacheEntry(set, repoAfterStatus, repoInstanceId)
        },
        onError: (message, r) => {
          if (isRepoUnavailableReason(message)) markRepoUnavailable(r, message)
        },
        onErrorLog: (message) => {
          refreshStatusLog.warn('failed', { err: new Error(message) })
        },
      })
    },

    async refreshCoreData(id: string, options?: { repoInstanceId?: string }) {
      const resolved = resolveActionRepoInstanceId(get, id, options?.repoInstanceId)
      if (!resolved) return
      const { repoInstanceId } = resolved
      await runCoreDataRefreshWorkflow(get, { id, repoInstanceId })
    },

    /**
     * Combined snapshot + status refresh backed by the
     * `POST /api/repo/composite` endpoint. Saves a round trip on
     * initial repo load by folding the two reads into one. Pull
     * requests are still fetched separately (different lane, different
     * retry semantics, different priority).
     */
    async refreshSnapshotAndStatus(id: string, options?: { skipLogBackfill?: boolean; repoInstanceId?: string }) {
      const resolved = resolveActionRepoInstanceId(get, id, options?.repoInstanceId)
      if (!resolved) return
      const { repoInstanceId } = resolved
      updateIfFresh(set, id, repoInstanceId, (r) => {
        startDataLoad(r.dataLoads.snapshot, { hasData: r.data.branches.length > 0 })
        startDataLoad(r.dataLoads.status, { hasData: r.data.statusLoaded || r.data.status.length > 0 })
      })
      await runLatestOperation({
        set,
        get,
        id,
        repoInstanceId,
        lane: 'read',
        operationKey: 'snapshot+status',
        priority: 50,
        targets: [
          { key: 'snapshot', reason: 'snapshot' },
          { key: 'status', reason: 'status' },
        ],
        task: (signal) => readRepoBulk(id, { include: ['snapshot', 'status'], signal }),
        errorFromResult: (result) => {
          // null on either side means soft-fail; treat as snapshot error
          // (status is allowed to be empty).
          return result.snapshot === null ? 'error.failed-read-repo' : null
        },
        onResult: async (result, ctx) => {
          if (ctx.isCurrent()) setRepoBulkReadQueryData(id, repoInstanceId, ['snapshot', 'status'], result)
          // Apply status first (leaf, no follow-up).
          updateIfFresh(set, id, repoInstanceId, (r) => {
            r.data.status = result.status
            r.data.statusLoaded = true
            r.data.worktreesByPath = applyStatusToWorktreeStates(r.data.worktreesByPath, result.status)
            // The composite started the status data load above but, unlike
            // snapshot which has a dedicated success flow that calls
            // finishDataLoadSuccess, status has no follow-up path. Without
            // this reset, the data load stays in 'loading'/'refreshing'
            // forever, blocking useRepoStatusRefresh's gate from firing
            // on the next status/changes tab open.
            finishDataLoadSuccess(r.dataLoads.status)
          })
          if (result.status.length > 0 && ctx.isCurrent()) {
            persistRepoSnapshotCacheEntry(set, get().repos[id], repoInstanceId)
          }
          if (result.snapshot === null) {
            updateIfFresh(set, id, repoInstanceId, (r) => {
              finishDataLoadError(r.dataLoads.snapshot, 'error.failed-read-repo')
              r.events = appendRepoEvent(r.events, errorEvent('error.failed-read-repo'))
            })
            return
          }
          await runSnapshotSuccessFlow(id, repoInstanceId, result.snapshot, ctx.isCurrent, {
            skipLogBackfill: options?.skipLogBackfill,
          })
        },
        onError: (message) => {
          updateIfFresh(set, id, repoInstanceId, (r) => {
            if (isRepoUnavailableReason(message)) markRepoUnavailable(r, message)
            finishDataLoadError(r.dataLoads.snapshot, message)
            finishDataLoadError(r.dataLoads.status, message)
            r.events = appendRepoEvent(r.events, errorEvent(message))
          })
        },
      })
    },

    /** Unified sync pipeline — local and remote repos follow the same path.
     *  1) Attempt a best-effort fetch when remotes are configured.
     *  2) Always refresh the local snapshot + status afterwards.
     *  Bookkeeping (setLastResult, clearFetchFailed) is handled inline
     *  so there is one source of truth for post-sync cleanup. */
    async syncAndRefresh(id: string, options?: { repoInstanceId?: string }) {
      const resolved = resolveActionRepoInstanceId(get, id, options?.repoInstanceId)
      if (!resolved) return
      const { repoInstanceId } = resolved
      await runExclusiveOperation({
        set,
        get,
        id,
        repoInstanceId,
        lane: 'read',
        priority: 100,
        targets: [{ key: 'manualRefresh', reason: 'manual-refresh' }],
        task: async () =>
          await runWithRepoInvalidationSource(
            'manual',
            async (sourceToken) => await runManualSyncPipeline(id, repoInstanceId, sourceToken),
          ),
      })
    },
  }
}
