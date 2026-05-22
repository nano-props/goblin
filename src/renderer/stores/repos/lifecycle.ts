import { lastPathSegment } from '#/renderer/lib/paths.ts'
import { emptyRepo, inFlightFetchById } from '#/renderer/stores/repos/helpers.ts'
import type { MissingRepo, OpenRepoResult, ReposGet, ReposSet, ReposStore } from '#/renderer/stores/repos/types.ts'

interface ResolvedRepo {
  id: string
  name: string
}

interface ProbeResult {
  input: string
  reason: string | null
  repo: ResolvedRepo | null
}

interface InitialRepoRefresh {
  id: string
  token: number
}

async function resolveRepoPath(
  p: string,
  onError?: (err: unknown) => void,
  fallbackError = 'error.failed-read-repo',
): Promise<ProbeResult> {
  try {
    const probe = await window.gbl.probe(p)
    if (!probe?.ok || !probe.root) return { input: p, reason: probe?.message ?? 'error.not-git-repo', repo: null }
    return {
      input: p,
      reason: null,
      repo: { id: probe.root, name: probe.name ?? lastPathSegment(probe.root) },
    }
  } catch (err) {
    onError?.(err)
    return { input: p, reason: err instanceof Error ? err.message : fallbackError, repo: null }
  }
}

function addResolvedRepos(
  s: Pick<ReposStore, 'repos' | 'order'>,
  resolvedRepos: ResolvedRepo[],
): Pick<ReposStore, 'repos' | 'order'> & { changed: boolean } {
  let repos = s.repos
  let order = s.order
  let changed = false
  for (const { id, name } of resolvedRepos) {
    if (repos[id]) continue
    if (!changed) {
      repos = { ...repos }
      order = [...order]
      changed = true
    }
    repos[id] = emptyRepo(id, name)
    order.push(id)
  }
  return { repos, order, changed }
}

function refreshInitialRepoState(get: ReposGet, refresh: InitialRepoRefresh) {
  const repo = get().repos[refresh.id]
  if (!repo || repo.instanceToken !== refresh.token) return
  void get().refreshSnapshot(refresh.id, { token: refresh.token })
  // Status drives the selected-branch detail badge, so load it
  // eagerly before the user opens the Status detail tab.
  void get().refreshStatus(refresh.id, { token: refresh.token })
}

export function createLifecycleActions(set: ReposSet, get: ReposGet) {
  return {
    async openRepo(p: string, options?: { activate?: boolean }): Promise<OpenRepoResult> {
      const resolved = await resolveRepoPath(p, undefined, 'error.not-git-repo')
      if (!resolved.repo) return { ok: false, message: resolved.reason ?? 'error.not-git-repo' }
      const repo = resolved.repo
      const { id } = repo
      const activate = options?.activate !== false
      let initialRefresh: InitialRepoRefresh | null = null
      void window.gbl.settings.addRecentRepo(id).catch(() => {
        /* recent menu is best-effort */
      })

      // Branch on the two axes (already in store? activating?) so each
      // case writes only what actually changes. zustand v5 short-circuits
      // notification when the setter returns the *same* state reference
      // (`Object.is(next, prev)`), so returning `s` when there's nothing
      // to do skips both the merge and the listener fan-out.
      set((s) => {
        const existingRepo = s.repos[id]
        const { repos, order, changed } = addResolvedRepos(s, [repo])
        const repoToRefresh = changed ? repos[id] : existingRepo
        if (repoToRefresh) initialRefresh = { id, token: repoToRefresh.instanceToken }
        if (!changed) {
          // Already active or caller doesn't want to focus → genuine no-op.
          if (!activate || s.activeId === id) return s
          return { activeId: id }
        }
        return activate ? { repos, order, activeId: id } : { repos, order }
      })

      if (initialRefresh) refreshInitialRepoState(get, initialRefresh)
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
      const probes = await Promise.all(
        openRepos.map((p) =>
          resolveRepoPath(p, (err) => {
            console.warn(`[session] probe failed for ${p}:`, err)
          }),
        ),
      )
      const valid = probes.filter((x) => x.repo !== null).map((x) => x.repo!)
      const missing: MissingRepo[] = probes
        .filter((x) => x.repo === null)
        .map((x) => ({ path: x.input, reason: x.reason ?? 'error.failed-read-repo' }))
      let initialRefreshes: InitialRepoRefresh[] = []

      set((s) => {
        const { repos, order } = addResolvedRepos(s, valid)
        initialRefreshes = valid.flatMap(({ id }) => {
          const repo = repos[id]
          return repo ? [{ id, token: repo.instanceToken }] : []
        })
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

      // See `openRepo`: status backs the selected-branch detail badge,
      // so we hydrate it for every restored repo, not just the active
      // one — switching after boot shouldn't reveal a stale 0.
      for (const refresh of initialRefreshes) {
        refreshInitialRepoState(get, refresh)
      }
    },

    dismissMissing() {
      set({ missingFromSession: [] })
    },
  }
}
