import { inFlightFetchById, updateIfFresh } from '#/renderer/stores/repos/helpers.ts'
import type { ReposGet, ReposSet } from '#/renderer/stores/repos/types.ts'

export function createRefreshActions(set: ReposSet, get: ReposGet) {
  return {
    async refreshSnapshot(id: string, options?: { silent?: boolean; skipLogBackfill?: boolean; token?: number }) {
      const repoBefore = get().repos[id]
      if (!repoBefore) return
      const token = options?.token ?? repoBefore.instanceToken
      if (repoBefore.instanceToken !== token) return
      const silent = options?.silent === true
      if (!silent) {
        updateIfFresh(set, id, token, (r) => ({ ...r, loading: true, error: null }))
      }
      try {
        const snap = await window.gbl.snapshot(id)
        if (!snap) {
          updateIfFresh(set, id, token, (r) => ({ ...r, loading: false, error: 'error.failedReadRepo' }))
          return
        }
        updateIfFresh(set, id, token, (r) => {
          // Default selection: current branch on first load. Keep the
          // user's pick if it still exists, otherwise fall back so the
          // right pane never points at a stale name.
          const previousSelected = r.selectedBranch
          let selected = previousSelected
          if (!selected || !snap.branches.some((b) => b.name === selected)) {
            selected = snap.branches.find((b) => b.name === snap.current)?.name ?? snap.branches[0]?.name ?? null
          }
          const branchChanged = selected !== previousSelected
          return {
            ...r,
            branches: snap.branches,
            currentBranch: snap.current,
            selectedBranch: selected,
            log: branchChanged ? [] : r.log,
            selectedLogHash: branchChanged ? null : r.selectedLogHash,
            loading: false,
          }
        })
        // If the user pressed ⌘2 (Log) while the snapshot was in flight,
        // their setRightTab fired a refreshLog that bailed out because
        // selectedBranch was still null. Now that we have it, backfill
        // the data they're actually looking at.
        //
        const after = get().repos[id]
        if (after && after.instanceToken === token && after.rightTab === 'log' && !options?.skipLogBackfill) {
          void get().refreshLog(id)
        }
      } catch (err) {
        updateIfFresh(set, id, token, (r) => ({
          ...r,
          loading: false,
          error: err instanceof Error ? err.message : String(err),
        }))
      }
    },

    async refreshLog(id: string) {
      const repoBefore = get().repos[id]
      if (!repoBefore) return
      const token = repoBefore.instanceToken
      const branch = repoBefore.selectedBranch ?? repoBefore.currentBranch
      if (!branch) return
      try {
        const log = await window.gbl.log(id, branch, 100)
        updateIfFresh(set, id, token, (r) => {
          // Discard if the user moved to a different branch while we
          // were waiting — otherwise the previous branch's log would
          // overwrite the current one.
          const stillBranch = r.selectedBranch ?? r.currentBranch
          if (stillBranch !== branch) return r
          // Re-anchor the j/k cursor: keep it if the selected hash is
          // still in the new log, otherwise auto-select the head so j/k
          // is immediately usable when the user enters the tab.
          const stillHas = r.selectedLogHash && log.some((e) => e.hash === r.selectedLogHash)
          const selectedLogHash = stillHas ? r.selectedLogHash : (log[0]?.hash ?? null)
          return { ...r, log, selectedLogHash }
        })
      } catch (err) {
        console.warn('[refreshLog] failed', err)
        updateIfFresh(set, id, token, (r) => ({
          ...r,
          error: err instanceof Error ? err.message : String(err),
        }))
      }
    },

    async refreshStatus(id: string, options?: { token?: number }) {
      const repoBefore = get().repos[id]
      if (!repoBefore) return
      const token = options?.token ?? repoBefore.instanceToken
      if (repoBefore.instanceToken !== token) return
      try {
        const status = await window.gbl.status(id)
        updateIfFresh(set, id, token, (r) => ({ ...r, status }))
      } catch (err) {
        console.warn('[refreshStatus] failed', err)
        updateIfFresh(set, id, token, (r) => ({
          ...r,
          error: err instanceof Error ? err.message : String(err),
        }))
      }
    },

    async refreshAll(id: string) {
      if (!get().repos[id]) return
      await get().refreshSnapshot(id, { skipLogBackfill: true })
      // Status is always refreshed (regardless of which tab is active)
      // because the tab badge in the repo header surfaces the dirty file
      // count on every view — without this, the badge would be empty
      // until the user clicks into the Status tab. Log only matters when
      // it's visible, so we keep its refresh tab-gated.
      const after = get().repos[id]
      if (!after) return
      await get().refreshStatus(id)
      if (after.rightTab === 'log') await get().refreshLog(id)
    },

    async backgroundFetch(id: string) {
      // Coalesce: if a fetch is already running for this repo, return its
      // promise. Switching active back and forth on a slow network used
      // to fire overlapping fetches.
      const existing = inFlightFetchById.get(id)
      if (existing) return existing

      const repoBefore = get().repos[id]
      if (!repoBefore) return
      const token = repoBefore.instanceToken
      updateIfFresh(set, id, token, (r) => ({ ...r, fetching: true }))

      let work!: Promise<void>
      work = (async () => {
        try {
          const result = await window.gbl.fetch(id, 'background')
          if (!result.ok) {
            if (result.message === 'cancelled' || result.message === 'error.networkOpInProgress') return
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
          updateIfFresh(set, id, token, (r) => ({ ...r, fetching: false }))
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
