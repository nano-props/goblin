import { appendRepoEvent, errorEvent, updateIfFresh } from '#/web/stores/repos/helpers.ts'
import {
  isRepoUnavailableReason,
  markRepoAvailable,
  markRepoUnavailable,
} from '#/web/stores/repos/availability.ts'
import { selectedBranchForBranchSet } from '#/web/stores/repos/branch-view-mode.ts'
import { runExclusiveOperation, runLatestOperation } from '#/web/stores/repos/operation-runner.ts'
import { pruneRepoOperationViewsForBranches } from '#/web/stores/repos/operations.ts'
import { persistRepoCache } from '#/web/stores/repos/persistence.ts'
import { runLatestResourceOperation } from '#/web/stores/repos/resource-runner.ts'
import { canStartRemoteFetch } from '#/web/stores/repos/sync-state.ts'
import {
  applyStatusToWorktreeStates,
  stripBranchWorktreeMetadata,
  worktreeStatesFromBranches,
} from '#/web/stores/repos/worktree-state.ts'
import { pruneRepoBranchPullRequestOperations, repoOperationCurrent } from '#/web/stores/repos/runtime.ts'
import {
  runManualSyncResultWorkflow,
  runRefreshAllWorkflow,
  runSnapshotSuccessWorkflow,
} from '#/web/stores/repos/refresh-workflows.ts'
import {
  cancelResource,
  finishPullRequestResourceError,
  finishPullRequestResourceSuccess,
  finishPullRequestResourceUnavailable,
  finishResourceError,
  finishResourceSuccess,
  idlePullRequestResource,
  idleResource,
  startPullRequestResource,
  startResource,
} from '#/web/stores/repos/resources.ts'
import {
  fetchRepository,
  getRepositoryPullRequests,
  getRepositorySnapshot,
  getRepositoryStatus,
} from '#/web/app-data-client.ts'
import { branchPullRequestBelongsToBranch } from '#/shared/git-types.ts'
import type { RepoOperationReason, RepoPullRequestReason } from '#/web/stores/repos/operations.ts'
import type { ReposGet, ReposSet } from '#/web/stores/repos/types.ts'
import type { ExecResult, PullRequestFetchMode, PullRequestInfo } from '#/web/types.ts'
function mergePullRequest(
  previous: { pullRequest?: PullRequestInfo },
  next: PullRequestInfo,
  mode: PullRequestFetchMode,
): PullRequestInfo {
  const existing = previous.pullRequest
  const preserveExistingDetails =
    mode !== 'full' && !!existing && existing.number === next.number && existing.url === next.url
  if (!preserveExistingDetails) return next
  return {
    ...next,
    checks: existing.checks ?? next.checks,
    reviewDecision: existing.reviewDecision === undefined ? next.reviewDecision : existing.reviewDecision,
    mergeable: existing.mergeable ?? next.mergeable,
  }
}

function existingBranchNames(r: { data: { branches: Array<{ name: string }> } }): Set<string> {
  return new Set(r.data.branches.map((branch) => branch.name))
}

function finishPullRequestBranchResources(
  r: {
    resources: {
      pullRequestsByBranch: Record<string, ReturnType<typeof idlePullRequestResource>>
    }
  },
  branchNames: string[],
  existingBranches: Set<string>,
  finish: (resource: ReturnType<typeof idlePullRequestResource>) => void,
  options?: { createMissing?: boolean },
): void {
  for (const branch of branchNames) {
    if (!existingBranches.has(branch)) {
      delete r.resources.pullRequestsByBranch[branch]
      continue
    }
    const resource = options?.createMissing
      ? (r.resources.pullRequestsByBranch[branch] ??= idlePullRequestResource())
      : r.resources.pullRequestsByBranch[branch]
    if (resource) finish(resource)
  }
}

export function createRefreshActions(set: ReposSet, get: ReposGet) {
  async function runNetworkTask(
    id: string,
    task: (signal: AbortSignal) => Promise<ExecResult>,
    options?: { token?: number; reason?: RepoOperationReason; priority?: number },
  ): Promise<ExecResult | null> {
    const repoBefore = get().repos[id]
    if (!repoBefore) return null
    const token = options?.token ?? repoBefore.instanceToken
    if (repoBefore.instanceToken !== token) return null
    if (!canStartRemoteFetch(repoBefore)) return { ok: false, message: 'error.network-op-in-progress' }
    updateIfFresh(set, id, token, (r) => {
      startResource(r.resources.fetch, { hasData: r.resources.fetch.loadedAt !== null })
    })
    return runExclusiveOperation({
      set,
      get,
      id,
      token,
      lane: 'network',
      priority: options?.priority ?? 50,
      targets: [{ key: 'fetch', reason: options?.reason ?? 'network' }],
      busyResult: { ok: false, message: 'error.network-op-in-progress' },
      task,
      errorFromResult: (result) => (!result.ok && result.message !== 'cancelled' ? result.message : null),
      onResult: (result) => {
        updateIfFresh(set, id, token, (r) => {
          if (result.ok) finishResourceSuccess(r.resources.fetch)
          else if (result.message !== 'cancelled' && result.message !== 'error.network-op-in-progress') {
            finishResourceError(r.resources.fetch, result.message)
          } else {
            cancelResource(r.resources.fetch)
          }
        })
      },
      onError: (message) => {
        updateIfFresh(set, id, token, (r) => {
          finishResourceError(r.resources.fetch, message)
        })
      },
      rethrow: true,
    })
  }

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

  return {
    async refreshSnapshot(id: string, options?: { skipLogBackfill?: boolean; token?: number }) {
      const repoBefore = get().repos[id]
      if (!repoBefore) return
      const token = options?.token ?? repoBefore.instanceToken
      if (repoBefore.instanceToken !== token) return
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
          const validBranches = new Set(snap.branches.map((b) => b.name))
          updateIfFresh(set, id, token, (r) => {
            // Default selection: current branch on first load. Keep the
            // user's pick if it still exists, otherwise fall back so the
            // detail panel never points at a stale name.
            const selected = selectedBranchForBranchSet({
              branches: snap.branches,
              currentBranch: snap.current,
              selectedBranch: r.ui.selectedBranch,
              viewMode: r.ui.branchViewMode,
            })
            const preservePullRequests = snap.remote
              ? snap.remote.hasGitHubRemote === true
              : r.remote.hasGitHubRemote === true
            const pullRequestsByBranch = preservePullRequests
              ? new Map(
                  r.data.branches.flatMap((branch) =>
                    branch.pullRequest ? [[branch.name, branch.pullRequest] as const] : [],
                  ),
                )
              : new Map()
            // Preserve the last known PR while the async GitHub refresh below
            // runs. If GitHub is unavailable, refreshPullRequests keeps this
            // metadata instead of making the row flicker to "no PR"; local-only
            // repos clear it because there is no PR source to refresh.
            const branchesWithSnapshotWorktreeMetadata = snap.branches.map((branch) => {
              const pullRequest = branch.pullRequest ?? pullRequestsByBranch.get(branch.name)
              return pullRequest && branchPullRequestBelongsToBranch(branch, pullRequest)
                ? { ...branch, pullRequest }
                : branch
            })
            const branches = stripBranchWorktreeMetadata(branchesWithSnapshotWorktreeMetadata)
            r.data.branches = branches
            r.data.currentBranch = snap.current
            r.data.worktreesByPath = worktreeStatesFromBranches(
              branchesWithSnapshotWorktreeMetadata,
              r.data.worktreesByPath,
              r.data.status,
            )
            r.resources.pullRequestsByBranch = Object.fromEntries(
              Object.entries(r.resources.pullRequestsByBranch).filter(([branch]) => validBranches.has(branch)),
            )
            pruneRepoOperationViewsForBranches(r.operations, validBranches)
            r.ui.selectedBranch = selected
            if (snap.remote) {
              r.remote.remotes = snap.remote.remotes.map((remote) => remote.name)
              r.remote.remoteDetails = snap.remote.remotes
              r.remote.hasRemotes = snap.remote.hasRemotes
              r.remote.hasBrowserRemote = snap.remote.hasBrowserRemote
              r.remote.browserRemoteProvider = snap.remote.browserRemoteProvider
              r.remote.remoteProviders = snap.remote.remoteProviders
              r.remote.hasGitHubRemote = snap.remote.hasGitHubRemote
              if (!snap.remote.hasRemotes) {
                r.remote.fetchFailed = false
                r.remote.fetchError = null
              }
            }
            markRepoAvailable(r)
            if (
              r.ui.detailTab === 'terminal' &&
              !branches.some((branch) => branch.name === selected && branch.worktree?.path)
            ) {
              r.ui.detailTab = 'status'
            }
            r.cache.source = 'fresh'
            r.cache.savedAt = null
            finishResourceSuccess(r.resources.snapshot)
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
            isSnapshotCurrent: ctx.isCurrent,
            skipLogBackfill: options?.skipLogBackfill,
          })
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
      const repoBefore = get().repos[id]
      if (!repoBefore) return
      const token = options?.token ?? repoBefore.instanceToken
      if (repoBefore.instanceToken !== token) return
      if (repoBefore.availability.phase === 'unavailable') return
      const mode = options?.mode ?? 'full'
      const clearMissing = options?.clearMissing ?? mode === 'full'
      const branchNames = branchesArg ?? repoBefore.data.branches.map((branch) => branch.name)
      if (branchNames.length === 0) return
      if (repoBefore.remote.hasGitHubRemote !== true) return
      const requested = new Set(branchNames)
      updateIfFresh(set, id, token, (r) => {
        startPullRequestResource(r.resources.pullRequests, mode, {
          hasData: r.data.branches.some((branch) => requested.has(branch.name) && !!branch.pullRequest),
        })
        for (const branch of branchNames) {
          r.resources.pullRequestsByBranch[branch] ??= idlePullRequestResource()
          const branchState = r.data.branches.find((item) => item.name === branch)
          startPullRequestResource(r.resources.pullRequestsByBranch[branch], mode, {
            hasData: !!branchState?.pullRequest,
          })
        }
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
          updateIfFresh(set, id, token, (r) => {
            const existingBranches = existingBranchNames(r)
            if (entries === null) {
              finishPullRequestResourceUnavailable(r.resources.pullRequests, mode)
              finishPullRequestBranchResources(r, branchNames, existingBranches, (resource) =>
                finishPullRequestResourceUnavailable(resource, mode),
              )
              return
            }
            finishPullRequestResourceSuccess(r.resources.pullRequests, mode)
            finishPullRequestBranchResources(
              r,
              branchNames,
              existingBranches,
              (resource) => finishPullRequestResourceSuccess(resource, mode),
              { createMissing: true },
            )
            const byBranch = new Map(entries.map((entry) => [entry.branch, entry.pullRequest]))
            for (const branch of r.data.branches) {
              const pullRequest = byBranch.get(branch.name)
              if (pullRequest) {
                if (branchPullRequestBelongsToBranch(branch, pullRequest)) {
                  branch.pullRequest = mergePullRequest(branch, pullRequest, mode)
                } else branch.pullRequest = undefined
                continue
              }
              if (clearMissing && requested.has(branch.name) && branch.pullRequest) {
                branch.pullRequest = undefined
              }
            }
          })
          if (ctx.isCurrent()) persistRepoCache(set, get().repos[id], token)
        },
        onStale: (ctx) => {
          updateIfFresh(set, id, token, (r) => {
            const existingBranches = existingBranchNames(r)
            const currentBranches = branchNames.filter((branch) =>
              repoOperationCurrent(id, `pullRequest:${branch}`, ctx.operationId),
            )
            finishPullRequestBranchResources(r, currentBranches, existingBranches, (resource) =>
              finishPullRequestResourceUnavailable(resource, mode),
            )
          })
        },
        onError: (message) => {
          console.warn('[refreshPullRequests] failed', message)
          updateIfFresh(set, id, token, (r) => {
            finishPullRequestResourceError(r.resources.pullRequests, message)
            finishPullRequestBranchResources(r, branchNames, existingBranchNames(r), (resource) =>
              finishPullRequestResourceError(resource, message),
            )
            r.events = appendRepoEvent(r.events, errorEvent(message))
          })
        },
      })
    },

    async refreshStatus(id: string, options?: { token?: number }) {
      const repoBefore = get().repos[id]
      if (!repoBefore) return
      const token = options?.token ?? repoBefore.instanceToken
      if (repoBefore.instanceToken !== token) return
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
          if (ctx.isCurrent()) persistRepoCache(set, repoAfterStatus, token)
        },
        onError: (message, r) => {
          if (isRepoUnavailableReason(message)) markRepoUnavailable(r, message)
        },
        errorLog: '[refreshStatus] failed',
      })
    },

    async refreshAll(id: string, options?: { token?: number }) {
      const repoBefore = get().repos[id]
      if (!repoBefore) return
      const token = options?.token ?? repoBefore.instanceToken
      if (repoBefore.instanceToken !== token) return
      await runRefreshAllWorkflow(get, { id, token })
    },

    async syncAndRefresh(id: string, options?: { token?: number }) {
      const repoBefore = get().repos[id]
      if (!repoBefore) return
      const token = options?.token ?? repoBefore.instanceToken
      if (repoBefore.instanceToken !== token) return
      if (repoBefore.availability.phase === 'unavailable') {
        await get().refreshAll(id, { token })
        return
      }
      if (repoBefore.remote.hasRemotes === false) {
        await get().refreshAll(id, { token })
        return
      }
      if (!canStartRemoteFetch(repoBefore)) return
      let result: ExecResult | null
      try {
        result = await runNetworkTask(id, (signal) => fetchRepository(id, 'user', signal), {
          token,
          reason: 'user-fetch',
          priority: 100,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        get().setLastResult(id, { ok: false, message }, token)
        return
      }
      if (!result) return
      await runManualSyncResultWorkflow(get, { id, token, result })
    },
  }
}
