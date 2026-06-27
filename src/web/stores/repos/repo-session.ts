import pLimit from 'p-limit'
import type { RepoSessionHydrationOptions, ReposGet, ReposSet, ReposStore } from '#/web/stores/repos/types.ts'
import {
  insertPlaceholderRepo,
  addResolvedRepo,
  addUnavailableRepo,
  createRuntimeRepoLifecycleActions,
  refreshInitialRepoState,
  resolveRepoPath,
} from '#/web/stores/repos/lifecycle-write-paths.ts'
import { runRemoteRepoLifecycle } from '#/web/stores/repos/remote-lifecycle-orchestrator.ts'
import { activeRepoIdAfterWorkspaceHydration } from '#/web/open-workspace-state.ts'
import { isRemoteRepoId, type RepoSessionEntry } from '#/shared/remote-repo.ts'
import { restoreSessionWorkspacePaneStateInRepos } from '#/web/stores/repos/workspace-pane-session-restore.ts'

interface InitialRepoRefresh {
  id: string
  token: number
}

type RestorableWorkspaceLifecycleActions = Pick<ReposStore, 'hydrateSession'>

const SESSION_PROBE_CONCURRENCY = 4

function createRestorableWorkspaceLifecycleActions(set: ReposSet, get: ReposGet): RestorableWorkspaceLifecycleActions {
  return {
    async hydrateSession(
      openRepos: RepoSessionEntry[],
      activeRepo: string | null,
      options?: RepoSessionHydrationOptions,
    ) {
      const { signal, workspacePaneRestoreState } = options ?? {}
      // Boot/session restore of workspace membership and active repository. This
      // reopens what SessionState described, but does not subscribe the repos
      // store to future session writes from persistence.
      //
      // The flow is split into two phases so the repo picker never sits
      // empty on a slow SSH network:
      //   Phase 1 (synchronous): paint a placeholder repo for every entry
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
        const restoredRepos = restoreSessionWorkspacePaneStateInRepos(nextRepos, workspacePaneRestoreState)
        if (restoredRepos !== nextRepos) {
          changed = true
          nextRepos = restoredRepos
        }
        if (!changed) return s
        return { repos: nextRepos, order: nextOrder, activeId: nextActiveId }
      })

      // Flip sessionReady unconditionally once Phase 1 has finished.
      // With open repositories, the boot skeleton (shown only when no activeId) gives
      // way to a real workspace immediately — the per-repo body keeps
      // showing its own skeleton until each snapshot resolves. With no open
      // repositories (openRepos was empty), there's nothing else to compute but
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
            // apply its result.
            if (signal?.aborted) return
            if (isRemoteRepoId(entry.id)) {
              // Remote entries go through the unified orchestrator.
              // It owns: connecting → server boundary → ready/failed
              // → initial refresh. Local probes stay on the
              // legacy path below since they have no remote
              // lifecycle to converge.
              const outcome = await runRemoteRepoLifecycle(set, get, entry.id, { signal })
              if (signal?.aborted) return
              // Hydration must keep the user-selected active repo
              // in sync with the orchestrator's writes. The
              // orchestrator updates the store directly; we just
              // re-derive the activeId after each settlement.
              if (outcome) {
                set((s) => {
                  const { repos, order } = s
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
              }
              return
            }
            const probe = await resolveRepoPath(entry)
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
            // See `openRepo`: status backs the selected-branch workspace badge,
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
