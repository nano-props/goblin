import pLimit from 'p-limit'
import type { RepoSessionHydrationOptions, ReposGet, ReposSet, ReposStore } from '#/web/stores/repos/types.ts'
import {
  insertPlaceholderRepo,
  addResolvedRepo,
  closeRepoRuntimeInstanceWithCache,
  createRuntimeRepoSessionActions,
  openLocalRepoRuntimeForInput,
  openRepoRuntimeInstanceWithCache,
  refreshInitialRepoState,
  type RuntimeOpenResolvedRepo,
} from '#/web/stores/repos/repo-session-write-paths.ts'
import { runRemoteRepoConnection } from '#/web/stores/repos/remote-repo-connection-orchestrator.ts'
import { activeRepoIdAfterWorkspaceHydration } from '#/web/open-workspace-state.ts'
import { isRemoteRepoId, localRepoSessionEntry, type RepoSessionEntry } from '#/shared/remote-repo.ts'
import { restoreSessionWorkspacePaneStateInRepos } from '#/web/stores/repos/workspace-pane-session-restore.ts'

interface InitialRepoRefresh {
  id: string
  repoInstanceId: string
}

type RestorableWorkspaceLifecycleActions = Pick<ReposStore, 'hydrateRepoSession'>

const SESSION_PROBE_CONCURRENCY = 4

function createRestorableWorkspaceLifecycleActions(set: ReposSet, get: ReposGet): RestorableWorkspaceLifecycleActions {
  return {
    async hydrateRepoSession(
      openRepoEntries: RepoSessionEntry[],
      activeRepoId: string | null,
      options?: RepoSessionHydrationOptions,
    ) {
      const { signal, workspacePaneRestoreState } = options ?? {}
      // Boot/session restore of workspace membership and active repository. This
      // reopens what WorkspaceSessionState described, but does not subscribe the repos
      // store to future session writes from persistence.
      //
      // The flow is split into placeholder-ready and settled steps so the repo picker can render
      // server-authoritative placeholders before full refresh finishes:
      //   1. Establish runtime authority. Local entries go through
      //     the server's canonical open path (probe input -> canonical
      //     root -> repoInstanceId) before any repo state is written. Remote
      //     entries keep their remote id and are opened directly.
      //   2. Settle the restored repos. Local entries promote the
      //     canonical placeholder to a resolved repo and kick off initial
      //     refresh. Remote entries go through the unified orchestrator.
      //
      // sessionReady flips after placeholders are ready. The per-repo body keeps
      // showing its own skeleton until each snapshot resolves.
      const rankById = new Map<string, number>()
      openRepoEntries.forEach((entry, index) => {
        if (!rankById.has(entry.id)) rankById.set(entry.id, index)
      })
      const limitLocalRuntimeOpen = pLimit(SESSION_PROBE_CONCURRENCY)
      const runtimeInstanceIdPromiseByRepoId = new Map<string, Promise<string>>()
      const localRuntimeOpenPromiseByRepoId = new Map<string, Promise<RuntimeOpenResolvedRepo>>()
      const runtimeInstanceIdFor = (repoId: string): Promise<string> => {
        if (signal?.aborted) throw new Error('aborted')
        const existing = runtimeInstanceIdPromiseByRepoId.get(repoId)
        if (existing) return existing
        const created = openRepoRuntimeInstanceWithCache(repoId)
        runtimeInstanceIdPromiseByRepoId.set(repoId, created)
        return created
      }
      const localRuntimeOpenFor = (entry: RepoSessionEntry): Promise<RuntimeOpenResolvedRepo> => {
        if (signal?.aborted) throw new Error('aborted')
        const existing = localRuntimeOpenPromiseByRepoId.get(entry.id)
        if (existing) return existing
        const created = limitLocalRuntimeOpen(async () => await openLocalRepoRuntimeForInput(entry))
        localRuntimeOpenPromiseByRepoId.set(entry.id, created)
        return created
      }

      let managedActiveId: string | null = null
      const placeholderReady = Promise.all(
        openRepoEntries.map(async (entry) => {
          let placeholderEntry = entry
          let runtimeRepoRoot = entry.id
          let instanceId: string
          try {
            if (isRemoteRepoId(entry.id)) {
              instanceId = await runtimeInstanceIdFor(entry.id)
            } else {
              const opened = await localRuntimeOpenFor(entry)
              if (!opened.repo || !opened.repoInstanceId) return
              placeholderEntry = localRepoSessionEntry(opened.repo.id)
              runtimeRepoRoot = opened.repo.id
              instanceId = opened.repoInstanceId
            }
          } catch {
            return
          }
          if (signal?.aborted) {
            await closeRepoRuntimeInstanceWithCache(runtimeRepoRoot, instanceId)
            return
          }
          set((s) => {
            const { repos, order, changed } = insertPlaceholderRepo(
              { repos: s.repos, repoSnapshotCache: s.repoSnapshotCache, order: s.order },
              placeholderEntry,
              instanceId,
              rankById,
            )
            let nextRepos = repos
            let changedRepos = changed
            const restoredRepos = restoreSessionWorkspacePaneStateInRepos(nextRepos, workspacePaneRestoreState)
            if (restoredRepos !== nextRepos) {
              nextRepos = restoredRepos
              changedRepos = true
            }
            const nextActiveId = activeRepoIdAfterWorkspaceHydration(
              s.activeId,
              nextRepos,
              order,
              activeRepoId,
              managedActiveId,
            )
            if (s.activeId === null || s.activeId === managedActiveId) managedActiveId = nextActiveId
            if (!changedRepos && nextActiveId === s.activeId) return s
            return { repos: nextRepos, order, activeId: nextActiveId }
          })
        }),
      )

      const limitProbe = pLimit(SESSION_PROBE_CONCURRENCY)
      const probeWork = Promise.all(
        openRepoEntries.map((entry) =>
          limitProbe(async () => {
            // Respect the abort signal: if the caller (e.g. the boot
            // effect) unmounted, skip starting the probe and don't
            // apply its result.
            if (signal?.aborted) return
            if (isRemoteRepoId(entry.id)) {
              try {
                await runtimeInstanceIdFor(entry.id)
              } catch {
                return
              }
              // Remote entries go through the unified orchestrator. It owns:
              // connecting → server boundary → ready/failed → initial refresh.
              const outcome = await runRemoteRepoConnection(set, get, entry.id, { signal })
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
                    activeRepoId,
                    managedActiveId,
                  )
                  if (s.activeId === null || s.activeId === managedActiveId) managedActiveId = activeId
                  if (repos === s.repos && order === s.order && activeId === s.activeId) return s
                  return { repos, order, activeId }
                })
              }
              return
            }
            const probe = await localRuntimeOpenFor(entry)
            if (signal?.aborted) return
            if (!probe.repo || !probe.repoInstanceId) return

            const resolvedRepo = probe.repo
            const repoInstanceId = probe.repoInstanceId
            let initialRefresh: InitialRepoRefresh | null = null
            set((s) => {
              const { repos, order } = addResolvedRepo(s, resolvedRepo, repoInstanceId, rankById)
              // Hydration always kicks off an initial refresh: even
              // when the resolved probe matches the existing target
              // (or returns no target at all, for a local probe), the
              // user expects fresh data on boot, not a stale cached
              // projection that may be minutes old. The wasteful
              // refresh fix lives in ensureWorkspaceOpen, where the
              // "open an already-open repo" use case is just a focus
              // action.
              const repo = repos[resolvedRepo.id]
              if (repo) initialRefresh = { id: repo.id, repoInstanceId: repo.instanceId }
              const activeId = activeRepoIdAfterWorkspaceHydration(
                s.activeId,
                repos,
                order,
                activeRepoId,
                managedActiveId,
              )
              if (s.activeId === null || s.activeId === managedActiveId) managedActiveId = activeId
              if (repos === s.repos && order === s.order && activeId === s.activeId) return s
              return { repos, order, activeId }
            })
            // See `openRepo`: status backs the selected-branch repo workspace badge,
            // so we hydrate it for every restored repo, not just the active
            // one — switching after boot shouldn't reveal a stale 0.
            if (initialRefresh) refreshInitialRepoState(get, initialRefresh)
          }),
        ),
      )
      await placeholderReady
      // Flip sessionReady unconditionally once placeholders are ready.
      // With open repositories, the boot skeleton (shown only when no activeId) gives
      // way to a real workspace immediately — the per-repo body keeps
      // showing its own skeleton until each snapshot resolves. With no open
      // repositories (openRepoEntries was empty), there's nothing else to compute but
      // we still need to clear the boot skeleton, so just flip the flag.
      set((s) => {
        if (s.sessionReady) return s
        if (s.order.length === 0) return { sessionReady: true }
        const activeId = activeRepoIdAfterWorkspaceHydration(
          s.activeId,
          s.repos,
          s.order,
          activeRepoId,
          managedActiveId,
        )
        if (s.activeId === null || s.activeId === managedActiveId) managedActiveId = activeId
        return { activeId, sessionReady: true }
      })
      await probeWork
    },
  }
}

export function createRepoSessionActions(set: ReposSet, get: ReposGet) {
  return {
    ...createRuntimeRepoSessionActions(set, get),
    ...createRestorableWorkspaceLifecycleActions(set, get),
  }
}
