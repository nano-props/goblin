import { appendRepoEvent, errorEvent, inFlightFetchById, updateIfFresh } from '#/renderer/stores/repos/helpers.ts'
import { branchForVisibleLog, selectedBranchForBranchSet } from '#/renderer/stores/repos/branch-view-mode.ts'
import { persistRepoCache } from '#/renderer/stores/repos/persistence.ts'
import { canStartRemoteFetch } from '#/renderer/stores/repos/sync-state.ts'
import type { ReposGet, ReposSet } from '#/renderer/stores/repos/types.ts'
import type { PullRequestFetchMode, PullRequestInfo } from '#/renderer/types.ts'
import { rpc } from '#/renderer/rpc.ts'

let nextPullRequestsRequestId = 1

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

export function createRefreshActions(set: ReposSet, get: ReposGet) {
  async function refreshSelectedPullRequest(id: string, token: number): Promise<void> {
    const repo = get().repos[id]
    if (!repo || repo.instanceToken !== token || !repo.ui.selectedBranch) return
    await get().refreshPullRequests(id, [repo.ui.selectedBranch], { token, mode: 'full' })
  }

  return {
    async refreshSnapshot(id: string, options?: { silent?: boolean; skipLogBackfill?: boolean; token?: number }) {
      const repoBefore = get().repos[id]
      if (!repoBefore) return
      const token = options?.token ?? repoBefore.instanceToken
      if (repoBefore.instanceToken !== token) return
      const silent = options?.silent === true
      if (!silent) {
        updateIfFresh(set, id, token, (r) => {
          const hasData = r.data.branches.length > 0
          r.async.loading = !hasData
          r.async.refreshing = hasData || r.cache.source === 'cache'
        })
      }
      try {
        const snap = await rpc.repo.snapshot.query({ cwd: id })
        if (!snap) {
          updateIfFresh(set, id, token, (r) => {
            r.async.loading = false
            r.async.refreshing = false
            r.events = appendRepoEvent(r.events, errorEvent('error.failed-read-repo'))
          })
          return
        }
        updateIfFresh(set, id, token, (r) => {
          // Default selection: current branch on first load. Keep the
          // user's pick if it still exists, otherwise fall back so the
          // right pane never points at a stale name.
          const selected = selectedBranchForBranchSet({
            branches: snap.branches,
            currentBranch: snap.current,
            selectedBranch: r.ui.selectedBranch,
            viewMode: r.ui.branchViewMode,
          })
          const validBranches = new Set(snap.branches.map((b) => b.name))
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
            return pullRequest ? { ...branch, pullRequest } : branch
          })
          r.data.branches = branches
          r.data.currentBranch = snap.current
          r.data.logsByBranch = logsByBranch
          r.ui.selectedBranch = selected
          r.async.loading = false
          r.async.refreshing = false
          r.cache.source = 'fresh'
          r.cache.savedAt = null
        })
        persistRepoCache(set, get().repos[id], token)
        const branchNames = snap.branches.map((branch) => branch.name)
        void (async () => {
          try {
            await get().refreshPullRequests(id, branchNames, { token, mode: 'summary' })
            await refreshSelectedPullRequest(id, token)
            await get().refreshPullRequests(id, branchNames, {
              token,
              mode: 'full',
              silent: true,
              clearMissing: false,
            })
          } catch (err) {
            console.warn('[refreshPullRequests] failed', err)
          }
        })()
        // If the user opened Commits while the snapshot was in flight,
        // their setDetailTab fired a refreshBranchLog that bailed out because
        // selectedBranch was still null. Now that we have it, backfill
        // the data they're actually looking at.
        //
        const after = get().repos[id]
        if (
          after &&
          after.instanceToken === token &&
          after.ui.detailTab === 'commits' &&
          after.ui.selectedBranch &&
          !options?.skipLogBackfill
        ) {
          void get().refreshBranchLog(id, after.ui.selectedBranch, { token })
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        updateIfFresh(set, id, token, (r) => {
          r.async.loading = false
          r.async.refreshing = false
          r.events = appendRepoEvent(r.events, errorEvent(message))
        })
      }
    },

    async refreshPullRequests(
      id: string,
      branchesArg?: string[],
      options?: { token?: number; mode?: PullRequestFetchMode; silent?: boolean; clearMissing?: boolean },
    ) {
      const repoBefore = get().repos[id]
      if (!repoBefore) return
      const token = options?.token ?? repoBefore.instanceToken
      if (repoBefore.instanceToken !== token) return
      const mode = options?.mode ?? 'full'
      const silent = options?.silent === true
      if (silent && repoBefore.async.pullRequestsLoading) return
      const clearMissing = options?.clearMissing ?? mode === 'full'
      const branchNames = branchesArg ?? repoBefore.data.branches.map((branch) => branch.name)
      if (branchNames.length === 0) return
      const requested = new Set(branchNames)
      const requestId = nextPullRequestsRequestId++
      updateIfFresh(set, id, token, (r) => {
        r.async.pullRequestsLoading = silent ? r.async.pullRequestsLoading : true
        r.async.pullRequestsRequestId = requestId
      })
      try {
        const entries = await rpc.repo.pullRequests.query({ cwd: id, branches: branchNames, options: { mode } })
        if (entries === null) {
          updateIfFresh(set, id, token, (r) => {
            if (r.async.pullRequestsRequestId === requestId) r.async.pullRequestsLoading = false
          })
          return
        }
        updateIfFresh(set, id, token, (r) => {
          if (r.async.pullRequestsRequestId !== requestId) return
          const byBranch = new Map(entries.map((entry) => [entry.branch, entry.pullRequest]))
          for (const branch of r.data.branches) {
            const pullRequest = byBranch.get(branch.name)
            if (pullRequest) {
              branch.pullRequest = mergePullRequest(branch, pullRequest, mode)
              continue
            }
            if (clearMissing && requested.has(branch.name) && branch.pullRequest) {
              delete branch.pullRequest
            }
          }
          r.async.pullRequestsLoading = false
        })
        persistRepoCache(set, get().repos[id], token)
      } catch (err) {
        console.warn('[refreshPullRequests] failed', err)
        updateIfFresh(set, id, token, (r) => {
          if (r.async.pullRequestsRequestId === requestId) r.async.pullRequestsLoading = false
        })
      }
    },

    async refreshBranchLog(id: string, branchArg?: string, options?: { token?: number }) {
      const repoBefore = get().repos[id]
      if (!repoBefore) return
      const token = options?.token ?? repoBefore.instanceToken
      if (repoBefore.instanceToken !== token) return
      const branch = branchArg ?? branchForVisibleLog(repoBefore)
      if (!branch) return
      updateIfFresh(set, id, token, (r) => {
        if (r.data.branches.length > 0 && !r.data.branches.some((b) => b.name === branch)) return
        const prev = r.data.logsByBranch[branch] ?? { entries: [], selectedHash: null, loading: false }
        r.data.logsByBranch[branch] = { ...prev, loading: true }
      })
      try {
        const log = await rpc.repo.log.query({ cwd: id, branch, count: 100 })
        updateIfFresh(set, id, token, (r) => {
          if (!r.data.branches.some((b) => b.name === branch)) return
          const prev = r.data.logsByBranch[branch] ?? { entries: [], selectedHash: null, loading: false }
          const stillHas = prev.selectedHash && log.some((e) => e.hash === prev.selectedHash)
          const selectedHash = stillHas ? prev.selectedHash : (log[0]?.hash ?? null)
          r.data.logsByBranch[branch] = { entries: log, selectedHash, loading: false }
        })
      } catch (err) {
        console.warn('[refreshBranchLog] failed', err)
        const message = err instanceof Error ? err.message : String(err)
        updateIfFresh(set, id, token, (r) => {
          if (r.data.branches.some((b) => b.name === branch)) {
            r.data.logsByBranch[branch] = {
              ...(r.data.logsByBranch[branch] ?? { entries: [], selectedHash: null }),
              loading: false,
            }
          }
          r.events = appendRepoEvent(r.events, errorEvent(message))
        })
      }
    },

    async refreshStatus(id: string, options?: { token?: number }) {
      const repoBefore = get().repos[id]
      if (!repoBefore) return
      const token = options?.token ?? repoBefore.instanceToken
      if (repoBefore.instanceToken !== token) return
      updateIfFresh(set, id, token, (r) => {
        r.async.statusLoading = true
        r.async.statusError = null
      })
      try {
        const status = await rpc.repo.status.query({ cwd: id })
        updateIfFresh(set, id, token, (r) => {
          r.data.status = status
          r.data.statusLoaded = true
          r.async.statusLoading = false
        })
        persistRepoCache(set, get().repos[id], token)
      } catch (err) {
        console.warn('[refreshStatus] failed', err)
        const message = err instanceof Error ? err.message : String(err)
        updateIfFresh(set, id, token, (r) => {
          r.async.statusLoading = false
          r.async.statusError = message
          r.events = appendRepoEvent(r.events, errorEvent(message))
        })
      }
    },

    async refreshAll(id: string, options?: { token?: number }) {
      const repoBefore = get().repos[id]
      if (!repoBefore) return
      const token = options?.token ?? repoBefore.instanceToken
      if (repoBefore.instanceToken !== token) return
      await get().refreshSnapshot(id, { skipLogBackfill: true, token })
      // Status is always refreshed (regardless of which detail tab is
      // active) because the selected-branch detail toolbar surfaces the
      // dirty file count on every view. Log only matters when it's
      // visible, so we keep its refresh tab-gated.
      const after = get().repos[id]
      if (!after || after.instanceToken !== token) return
      await get().refreshStatus(id, { token })
      if (after.ui.detailTab === 'commits') await get().refreshBranchLog(id, undefined, { token })
    },

    async syncAndRefresh(id: string, options?: { token?: number }) {
      const repoBefore = get().repos[id]
      if (!repoBefore) return
      const token = options?.token ?? repoBefore.instanceToken
      if (repoBefore.instanceToken !== token) return
      if (!canStartRemoteFetch(repoBefore)) return
      updateIfFresh(set, id, token, (r) => {
        r.async.syncing = true
      })
      try {
        const result = await rpc.repo.fetch.mutate({ cwd: id })
        const afterFetch = get().repos[id]
        if (!afterFetch || afterFetch.instanceToken !== token) return
        if (!result.ok && result.message === 'cancelled') return
        get().setLastResult(id, result, token)
        if (!result.ok && result.message === 'error.network-op-in-progress') return
        await get().refreshAll(id, { token })
        if (result.ok) get().clearFetchFailed(id, token)
      } finally {
        updateIfFresh(set, id, token, (r) => {
          r.async.syncing = false
          r.async.lastFetchSettledAt = Date.now()
        })
      }
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
      updateIfFresh(set, id, token, (r) => {
        r.async.fetching = true
      })

      let work!: Promise<void>
      work = (async () => {
        try {
          const result = await rpc.repo.fetch.mutate({ cwd: id, kind: 'background' })
          if (!result.ok) {
            if (result.message === 'cancelled' || result.message === 'error.network-op-in-progress') return
            console.warn('[backgroundFetch] git fetch failed:', result.message)
            updateIfFresh(set, id, token, (r) => {
              r.remote.fetchFailed = true
              r.remote.fetchError = result.message
            })
            await get().refreshStatus(id, { token })
            return
          }
          // Success — clear the fail flag and refresh the snapshot/status.
          updateIfFresh(set, id, token, (r) => {
            r.remote.fetchFailed = false
            r.remote.fetchError = null
          })
          await get().refreshSnapshot(id, { silent: true, token })
          await get().refreshStatus(id, { token })
        } catch (err) {
          console.warn('[backgroundFetch] threw:', err)
          const message = err instanceof Error ? err.message : String(err)
          updateIfFresh(set, id, token, (r) => {
            r.remote.fetchFailed = true
            r.remote.fetchError = message
          })
        } finally {
          updateIfFresh(set, id, token, (r) => {
            r.async.fetching = false
            r.async.lastFetchSettledAt = Date.now()
          })
          // Only clear the slot if it still refers to this run. Without
          // the identity check, a close + reopen + new fetch can land
          // before this finally runs, and we'd wipe the new run's entry.
          // `work` is the promise we just registered above — by the time
          // any awaited body resolves, the assignment below has run.
          if (inFlightFetchById.get(id) === work) inFlightFetchById.delete(id)
        }
      })()
      inFlightFetchById.set(id, work)
      return work
    },
  }
}
