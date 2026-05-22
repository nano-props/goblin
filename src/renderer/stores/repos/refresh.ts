import { errorEvent, inFlightFetchById, updateIfFresh } from '#/renderer/stores/repos/helpers.ts'
import { branchForVisibleLog, selectedBranchForBranchSet } from '#/renderer/stores/repos/branch-view-mode.ts'
import { canStartRemoteFetch } from '#/renderer/stores/repos/sync-state.ts'
import type { ReposGet, ReposSet } from '#/renderer/stores/repos/types.ts'
import type { PullRequestFetchMode, PullRequestInfo } from '#/renderer/types.ts'

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
    if (!repo || repo.instanceToken !== token || !repo.selectedBranch) return
    await get().refreshPullRequests(id, [repo.selectedBranch], { token, mode: 'full' })
  }

  return {
    async refreshSnapshot(id: string, options?: { silent?: boolean; skipLogBackfill?: boolean; token?: number }) {
      const repoBefore = get().repos[id]
      if (!repoBefore) return
      const token = options?.token ?? repoBefore.instanceToken
      if (repoBefore.instanceToken !== token) return
      const silent = options?.silent === true
      if (!silent) {
        updateIfFresh(set, id, token, (r) => ({ ...r, loading: true }))
      }
      try {
        const snap = await window.gbl.snapshot(id)
        if (!snap) {
          updateIfFresh(set, id, token, (r) => ({
            ...r,
            loading: false,
            events: [...r.events, errorEvent('error.failed-read-repo')],
          }))
          return
        }
        updateIfFresh(set, id, token, (r) => {
          // Default selection: current branch on first load. Keep the
          // user's pick if it still exists, otherwise fall back so the
          // right pane never points at a stale name.
          const selected = selectedBranchForBranchSet({
            branches: snap.branches,
            currentBranch: snap.current,
            selectedBranch: r.selectedBranch,
            viewMode: r.branchViewMode,
          })
          const validBranches = new Set(snap.branches.map((b) => b.name))
          const logsByBranch = Object.fromEntries(
            Object.entries(r.logsByBranch).filter(([branch]) => validBranches.has(branch)),
          )
          const pullRequestsByBranch = new Map(
            r.branches.flatMap((branch) => (branch.pullRequest ? [[branch.name, branch.pullRequest] as const] : [])),
          )
          // Preserve the last known PR while the async GitHub refresh below
          // runs. If GitHub is unavailable, refreshPullRequests keeps this
          // metadata instead of making the row flicker to "no PR".
          const branches = snap.branches.map((branch) => {
            const pullRequest = branch.pullRequest ?? pullRequestsByBranch.get(branch.name)
            return pullRequest ? { ...branch, pullRequest } : branch
          })
          return {
            ...r,
            branches,
            currentBranch: snap.current,
            selectedBranch: selected,
            logsByBranch,
            loading: false,
          }
        })
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
          after.detailTab === 'commits' &&
          after.selectedBranch &&
          !options?.skipLogBackfill
        ) {
          void get().refreshBranchLog(id, after.selectedBranch, { token })
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        updateIfFresh(set, id, token, (r) => ({
          ...r,
          loading: false,
          events: [...r.events, errorEvent(message)],
        }))
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
      if (silent && repoBefore.pullRequestsLoading) return
      const clearMissing = options?.clearMissing ?? mode === 'full'
      const branchNames = branchesArg ?? repoBefore.branches.map((branch) => branch.name)
      if (branchNames.length === 0) return
      const requested = new Set(branchNames)
      const requestId = nextPullRequestsRequestId++
      updateIfFresh(set, id, token, (r) => ({
        ...r,
        pullRequestsLoading: silent ? r.pullRequestsLoading : true,
        pullRequestsRequestId: requestId,
      }))
      try {
        const entries = await window.gbl.pullRequests(id, branchNames, { mode })
        if (entries === null) {
          updateIfFresh(set, id, token, (r) =>
            r.pullRequestsRequestId === requestId ? { ...r, pullRequestsLoading: false } : r,
          )
          return
        }
        updateIfFresh(set, id, token, (r) => {
          if (r.pullRequestsRequestId !== requestId) return r
          const byBranch = new Map(entries.map((entry) => [entry.branch, entry.pullRequest]))
          let changed = false
          const branches = r.branches.map((branch) => {
            const pullRequest = byBranch.get(branch.name)
            if (pullRequest) {
              changed = true
              return { ...branch, pullRequest: mergePullRequest(branch, pullRequest, mode) }
            }
            if (clearMissing && requested.has(branch.name) && branch.pullRequest) {
              const { pullRequest: _pullRequest, ...rest } = branch
              changed = true
              return rest
            }
            return branch
          })
          return changed ? { ...r, branches, pullRequestsLoading: false } : { ...r, pullRequestsLoading: false }
        })
      } catch (err) {
        console.warn('[refreshPullRequests] failed', err)
        updateIfFresh(set, id, token, (r) =>
          r.pullRequestsRequestId === requestId ? { ...r, pullRequestsLoading: false } : r,
        )
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
        if (r.branches.length > 0 && !r.branches.some((b) => b.name === branch)) return r
        const prev = r.logsByBranch[branch] ?? { entries: [], selectedHash: null, loading: false }
        return { ...r, logsByBranch: { ...r.logsByBranch, [branch]: { ...prev, loading: true } } }
      })
      try {
        const log = await window.gbl.log(id, branch, 100)
        updateIfFresh(set, id, token, (r) => {
          if (!r.branches.some((b) => b.name === branch)) return r
          const prev = r.logsByBranch[branch] ?? { entries: [], selectedHash: null, loading: false }
          const stillHas = prev.selectedHash && log.some((e) => e.hash === prev.selectedHash)
          const selectedHash = stillHas ? prev.selectedHash : (log[0]?.hash ?? null)
          return { ...r, logsByBranch: { ...r.logsByBranch, [branch]: { entries: log, selectedHash, loading: false } } }
        })
      } catch (err) {
        console.warn('[refreshBranchLog] failed', err)
        const message = err instanceof Error ? err.message : String(err)
        updateIfFresh(set, id, token, (r) => ({
          ...r,
          logsByBranch: r.branches.some((b) => b.name === branch)
            ? {
                ...r.logsByBranch,
                [branch]: { ...(r.logsByBranch[branch] ?? { entries: [], selectedHash: null }), loading: false },
              }
            : r.logsByBranch,
          events: [...r.events, errorEvent(message)],
        }))
      }
    },

    async refreshStatus(id: string, options?: { token?: number }) {
      const repoBefore = get().repos[id]
      if (!repoBefore) return
      const token = options?.token ?? repoBefore.instanceToken
      if (repoBefore.instanceToken !== token) return
      updateIfFresh(set, id, token, (r) => ({ ...r, statusLoading: true, statusError: null }))
      try {
        const status = await window.gbl.status(id)
        updateIfFresh(set, id, token, (r) => ({ ...r, status, statusLoading: false, statusLoaded: true }))
      } catch (err) {
        console.warn('[refreshStatus] failed', err)
        const message = err instanceof Error ? err.message : String(err)
        updateIfFresh(set, id, token, (r) => ({
          ...r,
          statusLoading: false,
          statusError: message,
          events: [...r.events, errorEvent(message)],
        }))
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
      if (after.detailTab === 'commits') await get().refreshBranchLog(id, undefined, { token })
    },

    async syncAndRefresh(id: string, options?: { token?: number }) {
      const repoBefore = get().repos[id]
      if (!repoBefore) return
      const token = options?.token ?? repoBefore.instanceToken
      if (repoBefore.instanceToken !== token) return
      if (!canStartRemoteFetch(repoBefore)) return
      updateIfFresh(set, id, token, (r) => ({ ...r, syncing: true }))
      try {
        const result = await window.gbl.fetch(id)
        const afterFetch = get().repos[id]
        if (!afterFetch || afterFetch.instanceToken !== token) return
        if (!result.ok && result.message === 'cancelled') return
        get().setLastResult(id, result, token)
        if (!result.ok && result.message === 'error.network-op-in-progress') return
        await get().refreshAll(id, { token })
        if (result.ok) get().clearFetchFailed(id, token)
      } finally {
        updateIfFresh(set, id, token, (r) => ({ ...r, syncing: false, lastFetchSettledAt: Date.now() }))
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
      updateIfFresh(set, id, token, (r) => ({ ...r, fetching: true }))

      let work!: Promise<void>
      work = (async () => {
        try {
          const result = await window.gbl.fetch(id, 'background')
          if (!result.ok) {
            if (result.message === 'cancelled' || result.message === 'error.network-op-in-progress') return
            console.warn('[backgroundFetch] git fetch failed:', result.message)
            updateIfFresh(set, id, token, (r) => ({
              ...r,
              fetchFailed: true,
              fetchError: result.message,
            }))
            await get().refreshStatus(id, { token })
            return
          }
          // Success — clear the fail flag and refresh the snapshot/status.
          updateIfFresh(set, id, token, (r) => ({ ...r, fetchFailed: false, fetchError: null }))
          await get().refreshSnapshot(id, { silent: true, token })
          await get().refreshStatus(id, { token })
        } catch (err) {
          console.warn('[backgroundFetch] threw:', err)
          const message = err instanceof Error ? err.message : String(err)
          updateIfFresh(set, id, token, (r) => ({
            ...r,
            fetchFailed: true,
            fetchError: message,
          }))
        } finally {
          updateIfFresh(set, id, token, (r) => ({ ...r, fetching: false, lastFetchSettledAt: Date.now() }))
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
