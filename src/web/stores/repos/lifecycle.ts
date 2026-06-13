import pLimit from 'p-limit'
import type { ReposGet, ReposSet, ReposStore } from '#/web/stores/repos/types.ts'
import {
  insertPlaceholderRepo,
  addResolvedRepo,
  addUnavailableRepo,
  createRuntimeRepoLifecycleActions,
  refreshInitialRepoState,
  resolveRepoPath,
} from '#/web/stores/repos/lifecycle-write-paths.ts'
import { activeRepoIdAfterWorkspaceHydration } from '#/web/open-workspace-state.ts'
import { repoSessionEntryId, type RepoSessionEntry } from '#/shared/remote-repo.ts'

interface InitialRepoRefresh {
  id: string
  token: number
}

type RestorableWorkspaceLifecycleActions = Pick<ReposStore, 'hydrateSession'>

const SESSION_PROBE_CONCURRENCY = 4

function createRestorableWorkspaceLifecycleActions(set: ReposSet, get: ReposGet): RestorableWorkspaceLifecycleActions {
  return {
    async hydrateSession(openRepos: RepoSessionEntry[], activeRepo: string | null, signal?: AbortSignal) {
      // Boot/session restore of workspace membership and active tab. This
      // reopens what SessionState described, but does not subscribe the repos
      // store to future session writes from persistence.
      //
      // The flow is split into two phases so the tab strip never sits
      // empty on a slow SSH network:
      //   Phase 1 (synchronous): paint a placeholder tab for every entry
      //     using the cached projection (if any) and the entry's own
      //     metadata. For remote entries the host/port are not yet known
      //     (resolveRemoteRepositoryTarget hasn't run), so the placeholder
      //     leaves `remote.target` undefined — that alone reads as
      //     `deriveConnectivity(repo) === 'connecting'`.
      //   Phase 2 (async): probe each entry with bounded concurrency.
      //     Probe success → addResolvedRepo (which fills in the real
      //     target and kicks off the initial refresh; connectivity
      //     naturally reads as 'connected' once the target lands).
      //     Probe failure → addUnavailableRepo (which flips availability
      //     to 'unavailable'; connectivity reads as 'unreachable').
      //
      // sessionReady flips as soon as the first placeholder lands —
      // which means right after Phase 1 completes — so the boot skeleton
      // gives way to a real workspace before any probe resolves. The
      // per-repo body keeps showing its skeleton until its own snapshot
      // resolves, but that's a per-repo concern.
      const rankById = new Map<string, number>()
      openRepos.forEach((entry, index) => {
        if (!rankById.has(entry.id)) rankById.set(entry.id, index)
      })

      let managedActiveId: string | null = null
      set((s) => {
        let nextActiveId: string | null = s.activeId
        let nextRepos = s.repos
        let nextOrder = s.order
        let changed = false
        for (const entry of openRepos) {
          const result = insertPlaceholderRepo(
            { repos: nextRepos, restorableRepoCache: s.restorableRepoCache, order: nextOrder },
            entry,
            rankById,
          )
          if (!result.changed) continue
          changed = true
          nextRepos = result.repos
          nextOrder = result.order
          nextActiveId = activeRepoIdAfterWorkspaceHydration(
            nextActiveId,
            nextRepos,
            nextOrder,
            activeRepo,
            managedActiveId,
          )
          if (s.activeId === null || s.activeId === managedActiveId) managedActiveId = nextActiveId
        }
        if (!changed) return s
        return { repos: nextRepos, order: nextOrder, activeId: nextActiveId }
      })

      // Flip sessionReady unconditionally once Phase 1 has finished.
      // With tabs, the boot skeleton (shown only when no activeId) gives
      // way to a real workspace immediately — the per-repo body keeps
      // showing its own skeleton until each snapshot resolves. With no
      // tabs (openRepos was empty), there's nothing else to compute but
      // we still need to clear the boot skeleton, so just flip the flag.
      set((s) => {
        if (s.sessionReady) return s
        if (s.order.length === 0) return { sessionReady: true }
        const activeId = activeRepoIdAfterWorkspaceHydration(s.activeId, s.repos, s.order, activeRepo, managedActiveId)
        if (s.activeId === null || s.activeId === managedActiveId) managedActiveId = activeId
        return { activeId, sessionReady: true }
      })

      const limitProbe = pLimit(SESSION_PROBE_CONCURRENCY)
      await Promise.all(
        openRepos.map((entry) =>
          limitProbe(async () => {
            // Respect the abort signal: if the caller (e.g. the boot
            // effect) unmounted, skip starting the probe and don't
            // apply its result. In-flight network calls can't be
            // cancelled through JS, but we don't process their results
            // and we don't keep the store from converging to its Phase 1
            // state.
            if (signal?.aborted) return
            const probe = await resolveRepoPath(entry, (err) => {
              console.warn(`[session] probe failed for ${repoSessionEntryId(entry)}:`, err)
            })
            if (signal?.aborted) return
            if (!probe.repo) {
              set((s) => {
                const { repos, order } = addUnavailableRepo(
                  s,
                  probe.input,
                  probe.reason ?? 'error.failed-read-repo',
                  probe.target,
                  rankById,
                )
                const activeId = activeRepoIdAfterWorkspaceHydration(
                  s.activeId,
                  repos,
                  order,
                  activeRepo,
                  managedActiveId,
                )
                if (s.activeId === null || s.activeId === managedActiveId) managedActiveId = activeId
                if (repos === s.repos && order === s.order && activeId === s.activeId) return s
                return { repos, order, activeId }
              })
              return
            }

            const resolvedRepo = probe.repo
            let initialRefresh: InitialRepoRefresh | null = null
            set((s) => {
              const { repos, order } = addResolvedRepo(s, resolvedRepo, rankById)
              // Hydration always kicks off an initial refresh: even
              // when the resolved probe matches the existing target
              // (or returns no target at all, for a local probe), the
              // user expects fresh data on boot, not a stale cached
              // projection that may be minutes old. The wasteful
              // refresh fix lives in ensureWorkspaceOpen, where the
              // "open an already-open repo" use case is just a focus
              // action.
              const repo = repos[resolvedRepo.id]
              if (repo) initialRefresh = { id: repo.id, token: repo.instanceToken }
              const activeId = activeRepoIdAfterWorkspaceHydration(
                s.activeId,
                repos,
                order,
                activeRepo,
                managedActiveId,
              )
              if (s.activeId === null || s.activeId === managedActiveId) managedActiveId = activeId
              if (repos === s.repos && order === s.order && activeId === s.activeId) return s
              return { repos, order, activeId }
            })
            // See `openRepo`: status backs the selected-branch detail badge,
            // so we hydrate it for every restored repo, not just the active
            // one — switching after boot shouldn't reveal a stale 0.
            if (initialRefresh) refreshInitialRepoState(get, initialRefresh)
          }),
        ),
      )
    },
  }
}

export function createLifecycleActions(set: ReposSet, get: ReposGet) {
  return {
    ...createRuntimeRepoLifecycleActions(set, get),
    ...createRestorableWorkspaceLifecycleActions(set, get),
  }
}
