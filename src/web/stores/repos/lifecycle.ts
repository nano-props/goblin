import pLimit from 'p-limit'
import type { ReposGet, ReposSet, ReposStore } from '#/web/stores/repos/types.ts'
import {
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

function createRestorableWorkspaceLifecycleActions(
  set: ReposSet,
  get: ReposGet,
): RestorableWorkspaceLifecycleActions {
  return {
    async hydrateSession(openRepos: RepoSessionEntry[], activeRepo: string | null) {
      // Boot/session restore of workspace membership and active tab. This
      // reopens what SessionState described, but does not subscribe the repos
      // store to future session writes from persistence.
      // Probe in parallel; entries that are no longer git repos (folder
      // moved/deleted, external drive not mounted) are restored as unavailable
      // tabs so the user's workspace shape stays intact.
      const rankById = new Map<string, number>()
      let managedActiveId: string | null = null
      const limitProbe = pLimit(SESSION_PROBE_CONCURRENCY)
      await Promise.all(
        openRepos.map((entry, index) =>
          limitProbe(async () => {
            const probe = await resolveRepoPath(entry, (err) => {
              console.warn(`[session] probe failed for ${repoSessionEntryId(entry)}:`, err)
            })
            if (!probe.repo) {
              if (!rankById.has(probe.input)) rankById.set(probe.input, index)
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
            if (!rankById.has(resolvedRepo.id)) rankById.set(resolvedRepo.id, index)
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

      set((s) => {
        const activeId = activeRepoIdAfterWorkspaceHydration(s.activeId, s.repos, s.order, activeRepo, managedActiveId)
        if (s.activeId === null || s.activeId === managedActiveId) managedActiveId = activeId
        return {
          activeId,
          sessionReady: true,
        }
      })
    },
  }
}

export function createLifecycleActions(set: ReposSet, get: ReposGet) {
  return {
    ...createRuntimeRepoLifecycleActions(set, get),
    ...createRestorableWorkspaceLifecycleActions(set, get),
  }
}
