import { appendRepoEvent, errorEvent, inFlightFetchById, updateIfFresh } from '#/renderer/stores/repos/helpers.ts'
import { branchForVisibleLog, selectedBranchForBranchSet } from '#/renderer/stores/repos/branch-view-mode.ts'
import { runExclusiveOperation, runLatestOperation } from '#/renderer/stores/repos/operation-runner.ts'
import { persistRepoCache } from '#/renderer/stores/repos/persistence.ts'
import { runLatestResourceOperation } from '#/renderer/stores/repos/resource-runner.ts'
import { canStartRemoteFetch } from '#/renderer/stores/repos/sync-state.ts'
import {
  pruneRepoBranchLogOperations,
  pruneRepoBranchPullRequestOperations,
  repoOperationBusy,
  repoOperationCurrent,
} from '#/renderer/stores/repos/runtime.ts'
import {
  recordBackgroundFetchThrownError,
  runBackgroundFetchResultWorkflow,
  runManualSyncResultWorkflow,
  runRefreshAllWorkflow,
  runSnapshotSuccessWorkflow,
} from '#/renderer/stores/repos/refresh-workflows.ts'
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
} from '#/renderer/stores/repos/resources.ts'
import { branchPullRequestBelongsToBranch } from '#/shared/git-types.ts'
import type { RepoOperationReason, RepoPullRequestReason } from '#/renderer/stores/repos/operations.ts'
import type { BranchLogState, ReposGet, ReposSet } from '#/renderer/stores/repos/types.ts'
import type { ExecResult, LogEntry, PullRequestFetchMode, PullRequestInfo } from '#/renderer/types.ts'
import { rpc } from '#/renderer/rpc.ts'

export const INITIAL_LOG_COUNT = 30
export const LOG_PAGE_SIZE = 30
export const MAX_LOG_COUNT = 300

function emptyBranchLog(): BranchLogState {
  return { entries: [], selectedHash: null, hasMore: false }
}

function logPage(entries: LogEntry[], pageSize: number): { entries: LogEntry[]; hasMore: boolean } {
  return { entries: entries.slice(0, pageSize), hasMore: entries.length > pageSize }
}

function mergePullRequest(
  previous: { pullRequest?: PullRequestInfo },
  next: PullRequestInfo,
  mode: PullRequestFetchMode,
): PullRequestInfo {
  const existing = previous.pullRequest
  if (mode === 'full' || !existing || existing.number !== next.number || existing.url !== next.url) return next
  return {
    ...next,
    checks: existing.checks ?? next.checks,
    reviewDecision: existing.reviewDecision !== undefined ? existing.reviewDecision : next.reviewDecision,
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

  async function refreshBranchLogPage(
    id: string,
    branchArg?: string,
    options?: { token?: number; append?: boolean },
  ): Promise<void> {
    const repoBefore = get().repos[id]
    if (!repoBefore) return
    const token = options?.token ?? repoBefore.instanceToken
    if (repoBefore.instanceToken !== token) return
    const branch = branchArg ?? branchForVisibleLog(repoBefore)
    if (!branch) return
    if (repoBefore.data.branches.length > 0 && !repoBefore.data.branches.some((b) => b.name === branch)) return
    const append = options?.append === true
    const existing = repoBefore.data.logsByBranch[branch]
    if (append) {
      if (!existing || repoOperationBusy(id, `log:${branch}`)) return
      if (!existing.hasMore || existing.entries.length >= MAX_LOG_COUNT) return
    }
    const loaded = append ? existing.entries.length : 0
    const pageSize = append ? Math.min(LOG_PAGE_SIZE, MAX_LOG_COUNT - loaded) : INITIAL_LOG_COUNT
    if (pageSize <= 0) return
    const requestCount = pageSize + 1
    await runLatestResourceOperation({
      set,
      get,
      id,
      token,
      lane: 'read',
      operationKey: `log:${branch}`,
      priority: 20,
      target: { key: `log:${branch}`, reason: 'log' },
      selectResource: (r) => (r.resources.logsByBranch[branch] ??= idleResource()),
      start: (r) => {
        r.data.logsByBranch[branch] ??= emptyBranchLog()
        r.resources.logsByBranch[branch] ??= idleResource()
        return { hasData: (r.data.logsByBranch[branch]?.entries.length ?? 0) > 0 }
      },
      task: (signal) => rpc.repo.log.query({ cwd: id, branch, count: requestCount, skip: loaded }, { signal }),
      applyResult: (r, log) => {
        if (!r.data.branches.some((b) => b.name === branch)) return false
        const prev = r.data.logsByBranch[branch] ?? emptyBranchLog()
        const page = logPage(log, pageSize)
        const entries = (append ? [...prev.entries, ...page.entries] : page.entries).slice(0, MAX_LOG_COUNT)
        const stillHas = prev.selectedHash && entries.some((e) => e.hash === prev.selectedHash)
        const selectedHash = stillHas ? prev.selectedHash : (entries[0]?.hash ?? null)
        r.data.logsByBranch[branch] = {
          entries,
          selectedHash,
          hasMore: entries.length < MAX_LOG_COUNT && page.hasMore,
        }
      },
      onError: (_message, r) => {
        if (r.data.branches.some((b) => b.name === branch)) r.data.logsByBranch[branch] ??= emptyBranchLog()
      },
      errorLog: '[refreshBranchLog] failed',
    })
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
        get,
        id,
        token,
        lane: 'read',
        operationKey: 'snapshot',
        priority: 50,
        targets: [{ key: 'snapshot', reason: 'snapshot' }],
        task: (signal) => rpc.repo.snapshot.query({ cwd: id }, { signal }),
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
            const logsByBranch = Object.fromEntries(
              Object.entries(r.data.logsByBranch).filter(([branch]) => validBranches.has(branch)),
            )
            const pullRequestsByBranch = new Map(
              r.data.branches.flatMap((branch) =>
                branch.pullRequest ? [[branch.name, branch.pullRequest] as const] : [],
              ),
            )
            // Preserve the last known PR while the async GitHub refresh below
            // runs. If GitHub is unavailable, refreshPullRequests keeps this
            // metadata instead of making the row flicker to "no PR".
            const branches = snap.branches.map((branch) => {
              const pullRequest = branch.pullRequest ?? pullRequestsByBranch.get(branch.name)
              return pullRequest && branchPullRequestBelongsToBranch(branch, pullRequest)
                ? { ...branch, pullRequest }
                : branch
            })
            r.data.branches = branches
            r.data.currentBranch = snap.current
            r.data.logsByBranch = logsByBranch
            r.resources.logsByBranch = Object.fromEntries(
              Object.entries(r.resources.logsByBranch).filter(([branch]) => validBranches.has(branch)),
            )
            r.resources.pullRequestsByBranch = Object.fromEntries(
              Object.entries(r.resources.pullRequestsByBranch).filter(([branch]) => validBranches.has(branch)),
            )
            r.ui.selectedBranch = selected
            if (
              r.ui.detailTab === 'terminal' &&
              !branches.some((branch) => branch.name === selected && branch.worktreePath)
            ) {
              r.ui.detailTab = 'status'
            }
            r.cache.source = 'fresh'
            r.cache.savedAt = null
            finishResourceSuccess(r.resources.snapshot)
          })
          pruneRepoBranchLogOperations(id, validBranches)
          pruneRepoBranchPullRequestOperations(id, validBranches)
          const branchNames = snap.branches.map((branch) => branch.name)
          const worktreePaths = snap.branches
            .map((branch) => branch.worktreePath)
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
      const mode = options?.mode ?? 'full'
      const clearMissing = options?.clearMissing ?? mode === 'full'
      const branchNames = branchesArg ?? repoBefore.data.branches.map((branch) => branch.name)
      if (branchNames.length === 0) return
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
        task: (signal) =>
          rpc.repo.pullRequests.query({ cwd: id, branches: branchNames, options: { mode } }, { signal }),
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
              repoOperationCurrent(id, `pullRequest:${branch}`, ctx.requestId),
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

    async refreshBranchLog(id: string, branchArg?: string, options?: { token?: number }) {
      await refreshBranchLogPage(id, branchArg, options)
    },

    async loadMoreBranchLog(id: string, branchArg?: string, options?: { token?: number }) {
      await refreshBranchLogPage(id, branchArg, { ...options, append: true })
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
        task: (signal) => rpc.repo.status.query({ cwd: id }, { signal }),
        applyResult: (r, status) => {
          r.data.status = status
          r.data.statusLoaded = true
        },
        onSuccess: (_status, ctx) => {
          const repoAfterStatus = get().repos[id]
          if (ctx.isCurrent()) persistRepoCache(set, repoAfterStatus, token)
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
      if (!canStartRemoteFetch(repoBefore)) return
      let result: ExecResult | null
      try {
        result = await runNetworkTask(id, (signal) => rpc.repo.fetch.mutate({ cwd: id }, { signal }), {
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

    async backgroundFetch(id: string) {
      // Coalesce: if a fetch is already running for this repo, return its
      // promise. Switching active back and forth on a slow network used
      // to fire overlapping fetches.
      const existing = inFlightFetchById.get(id)
      if (existing) return existing

      const repoBefore = get().repos[id]
      if (!repoBefore) return
      if (!canStartRemoteFetch(repoBefore)) return
      const token = repoBefore.instanceToken

      let resolveWork!: () => void
      let rejectWork!: (reason: unknown) => void
      const work = new Promise<void>((resolve, reject) => {
        resolveWork = resolve
        rejectWork = reject
      })
      inFlightFetchById.set(id, work)

      void (async () => {
        try {
          const result = await runNetworkTask(
            id,
            (signal) => rpc.repo.fetch.mutate({ cwd: id, kind: 'background' }, { signal }),
            { token, reason: 'background-fetch' },
          )
          if (!result) return
          await runBackgroundFetchResultWorkflow(set, get, { id, token, result })
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          if (message === 'Request aborted' || message === 'cancelled') return
          recordBackgroundFetchThrownError(set, { id, token, message, error: err })
        } finally {
          // Only clear the slot if it still refers to this run. Without
          // the identity check, a close + reopen + new fetch can land
          // before this finally runs, and we'd wipe the new run's entry.
          if (inFlightFetchById.get(id) === work) inFlightFetchById.delete(id)
        }
      })().then(resolveWork, rejectWork)
      return work
    },
  }
}
