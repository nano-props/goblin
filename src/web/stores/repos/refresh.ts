import { appendRepoEvent, errorEvent, updateIfFresh } from '#/web/stores/repos/helpers.ts'
import {
  isRepoUnavailableReason,
  markRepoUnavailable,
} from '#/web/stores/repos/availability.ts'
import { runExclusiveOperation, runLatestOperation } from '#/web/stores/repos/operation-runner.ts'
import { persistRestorableRepoSnapshot } from '#/web/stores/repos/persistence.ts'
import { runLatestResourceOperation } from '#/web/stores/repos/resource-runner.ts'
import { applyStatusToWorktreeStates } from '#/web/stores/repos/worktree-state.ts'
import {
  pruneRepoBranchPullRequestOperations,
} from '#/web/stores/repos/runtime.ts'
import {
  runCoreDataRefreshWorkflow,
  runSnapshotSuccessWorkflow,
} from '#/web/stores/repos/refresh-workflows.ts'
import {
  applyPullRequestRefreshErrorState,
  applyPullRequestRefreshStaleState,
  applyPullRequestRefreshSuccessState,
  applyPullRequestRefreshUnavailableState,
  applySnapshotToRepoProjection,
  resolveActionToken,
  startPullRequestRefreshResources,
} from '#/web/stores/repos/refresh-state.ts'
import { createRefreshSyncHelpers } from '#/web/stores/repos/refresh-sync.ts'
import { runWithRepoInvalidationSource } from '#/web/stores/repos/invalidation-sources.ts'
import {
  finishResourceError,
  startResource,
} from '#/web/stores/repos/resources.ts'
import {
  getRepositoryPullRequests,
  getRepositorySnapshot,
  getRepositoryStatus,
} from '#/web/app-data-client.ts'
import type { RepoSnapshot } from '#/shared/rpc.ts'
import type { RepoPullRequestReason } from '#/web/stores/repos/operations.ts'
import type { RepoState, ReposGet, ReposSet } from '#/web/stores/repos/types.ts'
import type { ExecResult, PullRequestFetchMode, PullRequestInfo } from '#/web/types.ts'

function resolvePullRequestRefreshRequest(
  repo: Pick<RepoState, 'availability' | 'data' | 'remote'>,
  branchesArg?: string[],
  options?: {
    mode?: PullRequestFetchMode
    clearMissing?: boolean
  },
):
  | {
      branchNames: string[]
      requested: Set<string>
      mode: PullRequestFetchMode
      clearMissing: boolean
    }
  | null {
  if (repo.availability.phase === 'unavailable') return null
  const mode = options?.mode ?? 'full'
  const clearMissing = options?.clearMissing ?? mode === 'full'
  const branchNames = branchesArg ?? repo.data.branches.map((branch) => branch.name)
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

  function runSnapshotSuccessFlow(
    id: string,
    token: number,
    snap: RepoSnapshot,
    isSnapshotCurrent: () => boolean,
    options?: { skipLogBackfill?: boolean },
  ): void {
    const validBranches = new Set(snap.branches.map((b) => b.name))
    updateIfFresh(set, id, token, (r) => {
      applySnapshotToRepoProjection(r, snap, validBranches)
    })
    pruneRepoBranchPullRequestOperations(id, validBranches)
    const branchNames = snap.branches.map((branch) => branch.name)
    const worktreePaths = snap.branches
      .map((branch) => branch.worktree?.path)
      .filter((p): p is string => typeof p === 'string' && p.length > 0)
    runSnapshotSuccessWorkflow(set, get, {
      id,
      token,
      branchNames,
      worktreePaths,
      isSnapshotCurrent,
      skipLogBackfill: options?.skipLogBackfill,
    })
  }

  function applyPullRequestRefreshUnavailable(
    id: string,
    token: number,
    branchNames: string[],
    mode: PullRequestFetchMode,
  ): void {
    updateIfFresh(set, id, token, (r) => {
      applyPullRequestRefreshUnavailableState(r, branchNames, mode)
    })
  }

  function applyPullRequestRefreshSuccess(
    id: string,
    token: number,
    branchNames: string[],
    entries: Array<{ branch: string; pullRequest: PullRequestInfo }>,
    requested: Set<string>,
    clearMissing: boolean,
    mode: PullRequestFetchMode,
  ): void {
    updateIfFresh(set, id, token, (r) => {
      applyPullRequestRefreshSuccessState(r, branchNames, entries, requested, clearMissing, mode)
    })
  }

  function applyPullRequestRefreshStale(
    id: string,
    token: number,
    branchNames: string[],
    mode: PullRequestFetchMode,
    operationId: number,
  ): void {
    updateIfFresh(set, id, token, (r) => {
      applyPullRequestRefreshStaleState(r, branchNames, mode, operationId)
    })
  }

  function applyPullRequestRefreshError(
    id: string,
    token: number,
    branchNames: string[],
    mode: PullRequestFetchMode,
    message: string,
  ): void {
    console.warn('[refreshPullRequests] failed', message)
    updateIfFresh(set, id, token, (r) => {
      applyPullRequestRefreshErrorState(r, branchNames, mode, message)
      r.events = appendRepoEvent(r.events, errorEvent(message))
    })
  }

  return {
    async refreshSnapshot(id: string, options?: { skipLogBackfill?: boolean; token?: number }) {
      const resolved = resolveActionToken(get, id, options?.token)
      if (!resolved) return
      const { token } = resolved
      updateIfFresh(set, id, token, (r) => {
        startResource(r.resources.snapshot, { hasData: r.data.branches.length > 0 })
      })
      await runLatestOperation({
        set,
        get,
        id,
        token,
        lane: 'read',
        operationKey: 'snapshot',
        priority: 50,
        targets: [{ key: 'snapshot', reason: 'snapshot' }],
        task: (signal) => getRepositorySnapshot(id, signal),
        errorFromResult: (snap) => (snap ? null : 'error.failed-read-repo'),
        onResult: (snap, ctx) => {
          if (!snap) {
            updateIfFresh(set, id, token, (r) => {
              finishResourceError(r.resources.snapshot, 'error.failed-read-repo')
              r.events = appendRepoEvent(r.events, errorEvent('error.failed-read-repo'))
            })
            return
          }
          runSnapshotSuccessFlow(id, token, snap, ctx.isCurrent, { skipLogBackfill: options?.skipLogBackfill })
        },
        onError: (message) => {
          updateIfFresh(set, id, token, (r) => {
            if (isRepoUnavailableReason(message)) markRepoUnavailable(r, message)
            finishResourceError(r.resources.snapshot, message)
            r.events = appendRepoEvent(r.events, errorEvent(message))
          })
        },
      })
    },

    async refreshPullRequests(
      id: string,
      branchesArg?: string[],
      options?: {
        token?: number
        mode?: PullRequestFetchMode
        clearMissing?: boolean
      },
    ) {
      const resolved = resolveActionToken(get, id, options?.token)
      if (!resolved) return
      const { repo: repoBefore, token } = resolved
      const request = resolvePullRequestRefreshRequest(repoBefore, branchesArg, options)
      if (!request) return
      const { branchNames, requested, mode, clearMissing } = request
      updateIfFresh(set, id, token, (r) => {
        startPullRequestRefreshResources(r, branchNames, requested, mode)
      })
      await runLatestOperation({
        set,
        get,
        id,
        token,
        lane: 'read',
        operationKey: 'pullRequests',
        priority: 10,
        targets: [
          { key: 'pullRequests', reason: pullRequestReason(mode) },
          ...branchNames.map((branch) => ({ key: `pullRequest:${branch}` as const, reason: pullRequestReason(mode) })),
        ],
        task: (signal) => getRepositoryPullRequests(id, branchNames, { mode }, signal),
        onResult: (entries, ctx) => {
          if (entries === null) {
            applyPullRequestRefreshUnavailable(id, token, branchNames, mode)
            return
          }
          applyPullRequestRefreshSuccess(id, token, branchNames, entries, requested, clearMissing, mode)
          if (ctx.isCurrent()) persistRestorableRepoSnapshot(set, get().repos[id], token)
        },
        onStale: (ctx) => {
          applyPullRequestRefreshStale(id, token, branchNames, mode, ctx.operationId)
        },
        onError: (message) => {
          applyPullRequestRefreshError(id, token, branchNames, mode, message)
        },
      })
    },

    async refreshStatus(id: string, options?: { token?: number }) {
      const resolved = resolveActionToken(get, id, options?.token)
      if (!resolved) return
      const { token } = resolved
      await runLatestResourceOperation({
        set,
        get,
        id,
        token,
        lane: 'read',
        operationKey: 'status',
        priority: 40,
        target: { key: 'status', reason: 'status' },
        selectResource: (r) => r.resources.status,
        start: (r) => ({ hasData: r.data.statusLoaded || r.data.status.length > 0 }),
        task: (signal) => getRepositoryStatus(id, signal),
        applyResult: (r, status) => {
          r.data.status = status
          r.data.statusLoaded = true
          r.data.worktreesByPath = applyStatusToWorktreeStates(r.data.worktreesByPath, status)
        },
        onSuccess: (_status, ctx) => {
          const repoAfterStatus = get().repos[id]
          if (ctx.isCurrent()) persistRestorableRepoSnapshot(set, repoAfterStatus, token)
        },
        onError: (message, r) => {
          if (isRepoUnavailableReason(message)) markRepoUnavailable(r, message)
        },
        errorLog: '[refreshStatus] failed',
      })
    },

    async refreshCoreData(id: string, options?: { token?: number }) {
      const resolved = resolveActionToken(get, id, options?.token)
      if (!resolved) return
      const { token } = resolved
      await runCoreDataRefreshWorkflow(get, { id, token })
    },

    /** Unified sync pipeline — local and remote repos follow the same path.
     *  1) Attempt a best-effort fetch when remotes are configured.
     *  2) Always refresh the local snapshot + status afterwards.
     *  Bookkeeping (setLastResult, clearFetchFailed) is handled inline
     *  so there is one source of truth for post-sync cleanup. */
    async syncAndRefresh(id: string, options?: { token?: number }) {
      const resolved = resolveActionToken(get, id, options?.token)
      if (!resolved) return
      const { token } = resolved
      await runExclusiveOperation({
        set,
        get,
        id,
        token,
        lane: 'read',
        priority: 100,
        targets: [{ key: 'manualRefresh', reason: 'manual-refresh' }],
        task: async () =>
          await runWithRepoInvalidationSource('manual', async (sourceToken) => await runManualSyncPipeline(id, token, sourceToken)),
      })
    },
  }
}
