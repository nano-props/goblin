import { lastPathSegment } from '#/renderer/lib/paths.ts'
import { emptyRepo, inFlightFetchById } from '#/renderer/stores/repos/helpers.ts'
import type { OpenRepoResult, ReposGet, ReposSet } from '#/renderer/stores/repos/types.ts'

export function createLifecycleActions(set: ReposSet, get: ReposGet) {
  return {
    async openRepo(p: string, options?: { activate?: boolean }): Promise<OpenRepoResult> {
      let probe
      try {
        probe = await window.gbl.probe(p)
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : 'error.notGitRepo' }
      }
      if (!probe?.ok || !probe.root) {
        return { ok: false, message: 'error.notGitRepo' }
      }
      const id = probe.root
      const name = probe.name ?? lastPathSegment(id)
      const activate = options?.activate !== false

      // Branch on the two axes (already in store? activating?) so each
      // case writes only what actually changes. zustand v5 short-circuits
      // notification when the setter returns the *same* state reference
      // (`Object.is(next, prev)`), so returning `s` when there's nothing
      // to do skips both the merge and the listener fan-out.
      set((s) => {
        const existing = s.repos[id] !== undefined
        if (existing) {
          // Already active or caller doesn't want to focus → genuine no-op.
          if (!activate || s.activeId === id) return s
          return { activeId: id }
        }
        const repos = { ...s.repos, [id]: emptyRepo(id, name) }
        const order = [...s.order, id]
        return activate ? { repos, order, activeId: id } : { repos, order }
      })

      const token = get().repos[id]?.instanceToken
      if (token === undefined) return { ok: true, id }
      void get().refreshSnapshot(id, { token })
      // Status drives the selected-branch detail badge, so load it
      // eagerly before the user opens the Status detail tab.
      void get().refreshStatus(id, { token })
      return { ok: true, id }
    },

    closeRepo(id: string) {
      // Drop any in-flight fetch tracking so a new openRepo of the same
      // path doesn't think a fetch is already running.
      inFlightFetchById.delete(id)
      // Tell main to abort any cancellable network op for this repo —
      // otherwise a `git push` started right before the user closed the
      // tab keeps running for up to the network timeout, charged to a
      // tab that no longer exists. Fire-and-forget; failure is fine.
      void window.gbl.abort(id).catch(() => {
        /* main may have nothing to abort — ignore */
      })
      set((s) => {
        if (!s.repos[id]) return s
        const repos = { ...s.repos }
        delete repos[id]
        const order = s.order.filter((x) => x !== id)
        let activeId = s.activeId
        // Slide focus to the right neighbour; fall back to the left if
        // we just removed the rightmost tab.
        if (activeId === id) {
          const idx = s.order.indexOf(id)
          activeId = order[idx] ?? order[idx - 1] ?? null
        }
        return { repos, order, activeId }
      })
    },

    async hydrateSession(openRepos: string[], activeRepo: string | null) {
      // Probe in parallel; entries that are no longer git repos (folder
      // moved/deleted, external drive not mounted) get reported via
      // `missingFromSession` so the user sees a "couldn't reopen N repos"
      // notice in the tab strip instead of wondering where their tabs went.
      interface ProbeResult {
        input: string
        ok: { id: string; name: string } | null
      }
      const probes = await Promise.all(
        openRepos.map(async (p): Promise<ProbeResult> => {
          try {
            const probe = await window.gbl.probe(p)
            if (!probe?.ok || !probe.root) return { input: p, ok: null }
            return {
              input: p,
              ok: { id: probe.root, name: probe.name ?? lastPathSegment(probe.root) },
            }
          } catch (err) {
            console.warn(`[session] probe failed for ${p}:`, err)
            return { input: p, ok: null }
          }
        }),
      )
      const valid = probes.filter((x) => x.ok !== null).map((x) => x.ok!)
      const missing = probes.filter((x) => x.ok === null).map((x) => x.input)

      set((s) => {
        const repos = { ...s.repos }
        const order = [...s.order]
        for (const { id, name } of valid) {
          if (!repos[id]) {
            repos[id] = emptyRepo(id, name)
            order.push(id)
          }
        }
        const userPickedSomething = s.activeId !== null
        const wantActive =
          userPickedSomething && repos[s.activeId!]
            ? s.activeId
            : activeRepo && repos[activeRepo]
              ? activeRepo
              : (order[0] ?? null)
        return {
          repos,
          order,
          activeId: wantActive,
          sessionReady: true,
          missingFromSession: missing,
        }
      })

      for (const { id } of valid) {
        const token = get().repos[id]?.instanceToken
        if (token === undefined) continue
        void get().refreshSnapshot(id, { token })
        // See `openRepo`: status backs the selected-branch detail badge,
        // so we hydrate it for every restored repo, not just the active
        // one — switching after boot shouldn't reveal a stale 0.
        void get().refreshStatus(id, { token })
      }
    },

    dismissMissing() {
      set({ missingFromSession: [] })
    },
  }
}
