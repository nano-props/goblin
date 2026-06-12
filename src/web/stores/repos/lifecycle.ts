import pLimit from 'p-limit'
import type { ReposGet, ReposSet, ReposStore } from '#/web/stores/repos/types.ts'
import {
  addConnectingRepo,
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
    async hydrateSession(openRepos: RepoSessionEntry[], activeRepo: string | null) {
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
          const result = addConnectingRepo({ repos: nextRepos, restorableRepoCache: s.restorableRepoCache, order: nextOrder }, entry, rankById)
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

      // Flip sessionReady as soon as any tab has been added. The repo
      // body will keep showing its per-repo skeleton until the snapshot
      // resolves, but the boot skeleton (shown only when no activeId)
      // gives way to a real workspace immediately.
      set((s) => {
        if (s.sessionReady) return s
        if (s.order.length === 0) return s
        const activeId = activeRepoIdAfterWorkspaceHydration(s.activeId, s.repos, s.order, activeRepo, managedActiveId)
        if (s.activeId === null || s.activeId === managedActiveId) managedActiveId = activeId
        return { activeId, sessionReady: true }
      })

      const limitProbe = pLimit(SESSION_PROBE_CONCURRENCY)
      await Promise.all(
        openRepos.map((entry) =>
          limitProbe(async () => {
            const probe = await resolveRepoPath(entry, (err) => {
              console.warn(`[session] probe failed for ${repoSessionEntryId(entry)}:`, err)
            })
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
      // Defensive: ensure sessionReady is true once hydration has finished,
      // even if openRepos was empty (so Phase 1 added nothing and the earlier
      // sessionReady flip never ran). Without this, a session with no tabs
      // would leave the boot skeleton up forever.
      set((s) => (s.sessionReady ? s : { sessionReady: true }))
    },
  }
}

export function createLifecycleActions(set: ReposSet, get: ReposGet) {
  return {
    ...createRuntimeRepoLifecycleActions(set, get),
    ...createRestorableWorkspaceLifecycleActions(set, get),
  }
}
