import pLimit from 'p-limit'
import type { RepoSessionHydrationOptions, ReposGet, ReposSet, ReposStore } from '#/web/stores/repos/types.ts'
import {
  insertPlaceholderRepo,
  addResolvedRepo,
  closeRepoRuntimeWithCache,
  createRuntimeRepoSessionActions,
  openLocalRepoRuntimeForInput,
  openRepoRuntimeWithCache,
  refreshInitialRepoState,
  type RuntimeOpenResolvedRepo,
} from '#/web/stores/repos/repo-session-write-paths.ts'
import { runRemoteRepoConnection } from '#/web/stores/repos/remote-repo-connection-orchestrator.ts'
import { restoredRepoIdAfterWorkspaceHydration } from '#/web/open-workspace-state.ts'
import { isRemoteRepoId, localRepoSessionEntry, type RepoSessionEntry } from '#/shared/remote-repo.ts'
import { restoreSessionWorkspacePaneStateInRepos } from '#/web/stores/repos/workspace-pane-session-restore.ts'

interface InitialRepoRefresh {
  id: string
  repoRuntimeId: string
}

type RestorableWorkspaceLifecycleActions = Pick<ReposStore, 'hydrateRepoSession'>

const SESSION_PROBE_CONCURRENCY = 4

function createRestorableWorkspaceLifecycleActions(set: ReposSet, get: ReposGet): RestorableWorkspaceLifecycleActions {
  return {
    async hydrateRepoSession(
      openRepoEntries: RepoSessionEntry[],
      restoredRepoId: string | null,
      options?: RepoSessionHydrationOptions,
    ) {
      const { signal, workspacePaneRestoreState } = options ?? {}
      // Boot/session restore of workspace membership and restored repository. This
      // reopens what WorkspaceSessionState described, but does not subscribe the repos
      // store to future session writes from persistence.
      //
      // The flow is split into placeholder-ready and settled steps so the repo picker can render
      // server-authoritative placeholders before full refresh finishes:
      //   1. Establish runtime authority. Local entries go through
      //     the server's canonical open path (probe input -> canonical
      //     root -> repoRuntimeId) before any repo state is written. Remote
      //     entries keep their remote id and are opened directly.
      //   2. Settle the restored repos. Local entries promote the
      //     canonical placeholder to a resolved repo and kick off initial
      //     refresh. Remote entries go through the unified orchestrator.
      //
      // workspaceMembershipReady means restored entries have produced
      // placeholders (or settled as absent). The per-repo body keeps showing
      // its own skeleton until each snapshot resolves.
      const rankById = new Map<string, number>()
      openRepoEntries.forEach((entry, index) => {
        if (!rankById.has(entry.id)) rankById.set(entry.id, index)
      })
      const limitLocalRuntimeOpen = pLimit(SESSION_PROBE_CONCURRENCY)
      const repoRuntimeIdPromiseByRepoId = new Map<string, Promise<string>>()
      const localRuntimeOpenPromiseByRepoId = new Map<string, Promise<RuntimeOpenResolvedRepo>>()
      const repoRuntimeIdFor = (repoId: string): Promise<string> => {
        if (signal?.aborted) throw new Error('aborted')
        const existing = repoRuntimeIdPromiseByRepoId.get(repoId)
        if (existing) return existing
        const created = openRepoRuntimeWithCache(repoId)
        repoRuntimeIdPromiseByRepoId.set(repoId, created)
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

      let managedRestoredRepoId: string | null = null
      const failedOpenEntryIds = new Set<string>()
      let workspacePaneRestoreFailed = false
      const markOpenEntryFailed = (entry: RepoSessionEntry): void => {
        failedOpenEntryIds.add(entry.id)
      }
      const placeholderReady = Promise.all(
        openRepoEntries.map(async (entry) => {
          let placeholderEntry = entry
          let runtimeRepoRoot = entry.id
          let repoRuntimeId: string
          try {
            if (isRemoteRepoId(entry.id)) {
              repoRuntimeId = await repoRuntimeIdFor(entry.id)
            } else {
              const opened = await localRuntimeOpenFor(entry)
              if (!opened.repo || !opened.repoRuntimeId) {
                markOpenEntryFailed(entry)
                return
              }
              placeholderEntry = localRepoSessionEntry(opened.repo.id)
              runtimeRepoRoot = opened.repo.id
              repoRuntimeId = opened.repoRuntimeId
            }
          } catch (err) {
            if (signal?.aborted || isAbortError(err)) return
            markOpenEntryFailed(entry)
            return
          }
          if (signal?.aborted) {
            await closeRepoRuntimeWithCache(runtimeRepoRoot, repoRuntimeId)
            return
          }
          set((s) => {
            const { repos, order, changed } = insertPlaceholderRepo(
              { repos: s.repos, repoSnapshotCache: s.repoSnapshotCache, order: s.order },
              placeholderEntry,
              repoRuntimeId,
              rankById,
            )
            let nextRepos = repos
            let changedRepos = changed
            const restoreResult = restoreSessionWorkspacePaneStateInRepos(nextRepos, workspacePaneRestoreState)
            if (restoreResult.status === 'failed') {
              workspacePaneRestoreFailed = true
            } else if (restoreResult.repos !== nextRepos) {
              nextRepos = restoreResult.repos
              changedRepos = true
            }
            const nextRestoredRepoId = restoredRepoIdAfterWorkspaceHydration(
              s.restoredRepoId,
              nextRepos,
              order,
              restoredRepoId,
              managedRestoredRepoId,
            )
            if (s.restoredRepoId === null || s.restoredRepoId === managedRestoredRepoId) {
              managedRestoredRepoId = nextRestoredRepoId
            }
            if (!changedRepos && nextRestoredRepoId === s.restoredRepoId) return s
            return { repos: nextRepos, order, restoredRepoId: nextRestoredRepoId }
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
                await repoRuntimeIdFor(entry.id)
              } catch (err) {
                if (!signal?.aborted && !isAbortError(err)) markOpenEntryFailed(entry)
                return
              }
              // Remote entries go through the unified orchestrator. It owns:
              // connecting → server boundary → ready/failed → initial refresh.
              const outcome = await runRemoteRepoConnection(set, get, entry.id, { signal })
              if (signal?.aborted) return
              // Hydration must keep the restored repo id in sync with the orchestrator's writes. The
              // orchestrator updates the store directly; we just
              // re-derive the restored repo id after each settlement.
              if (outcome) {
                set((s) => {
                  const { repos, order } = s
                  const nextRestoredRepoId = restoredRepoIdAfterWorkspaceHydration(
                    s.restoredRepoId,
                    repos,
                    order,
                    restoredRepoId,
                    managedRestoredRepoId,
                  )
                  if (s.restoredRepoId === null || s.restoredRepoId === managedRestoredRepoId) {
                    managedRestoredRepoId = nextRestoredRepoId
                  }
                  if (repos === s.repos && order === s.order && nextRestoredRepoId === s.restoredRepoId) return s
                  return { repos, order, restoredRepoId: nextRestoredRepoId }
                })
              }
              return
            }
            const probe = await localRuntimeOpenFor(entry)
            if (signal?.aborted) return
            if (!probe.repo || !probe.repoRuntimeId) {
              markOpenEntryFailed(entry)
              return
            }

            const resolvedRepo = probe.repo
            const repoRuntimeId = probe.repoRuntimeId
            let initialRefresh: InitialRepoRefresh | null = null
            set((s) => {
              const { repos, order } = addResolvedRepo(s, resolvedRepo, repoRuntimeId, rankById)
              // Hydration always kicks off an initial refresh: even
              // when the resolved probe matches the existing target
              // (or returns no target at all, for a local probe), the
              // user expects fresh data on boot, not a stale cached
              // projection that may be minutes old. The wasteful
              // refresh fix lives in ensureWorkspaceOpen, where the
              // "open an already-open repo" use case is just a focus
              // action.
              const repo = repos[resolvedRepo.id]
              if (repo) initialRefresh = { id: repo.id, repoRuntimeId: repo.repoRuntimeId }
              const nextRestoredRepoId = restoredRepoIdAfterWorkspaceHydration(
                s.restoredRepoId,
                repos,
                order,
                restoredRepoId,
                managedRestoredRepoId,
              )
              if (s.restoredRepoId === null || s.restoredRepoId === managedRestoredRepoId) {
                managedRestoredRepoId = nextRestoredRepoId
              }
              if (repos === s.repos && order === s.order && nextRestoredRepoId === s.restoredRepoId) return s
              return { repos, order, restoredRepoId: nextRestoredRepoId }
            })
            // See `openRepo`: status backs the selected-branch repo workspace badge,
            // so we hydrate it for every restored repo, not just the active
            // one — switching after boot shouldn't reveal a stale 0.
            if (initialRefresh) refreshInitialRepoState(set, get, initialRefresh)
          }),
        ),
      )
      await placeholderReady
      if (signal?.aborted) return
      // Flip workspaceMembershipReady unconditionally once workspace membership is ready.
      // With open repositories, the workspace restore skeleton gives
      // way to a real workspace immediately — the per-repo body keeps
      // showing its own skeleton until each snapshot resolves. With no open
      // repositories (openRepoEntries was empty), there's nothing else to compute but
      // we still need to clear the workspace restore skeleton, so just flip the flag.
      set((s) => {
        if (s.workspaceMembershipReady) return s
        if (s.order.length === 0) return { workspaceMembershipReady: true }
        const nextRestoredRepoId = restoredRepoIdAfterWorkspaceHydration(
          s.restoredRepoId,
          s.repos,
          s.order,
          restoredRepoId,
          managedRestoredRepoId,
        )
        if (s.restoredRepoId === null || s.restoredRepoId === managedRestoredRepoId) {
          managedRestoredRepoId = nextRestoredRepoId
        }
        return { restoredRepoId: nextRestoredRepoId, workspaceMembershipReady: true }
      })
      await probeWork
      if (restoredRepoId && !get().repos[restoredRepoId]) {
        set((s) => {
          const nextRestoredRepoId = restoredRepoIdAfterWorkspaceHydration(
            s.restoredRepoId,
            s.repos,
            s.order,
            null,
            managedRestoredRepoId,
          )
          if (s.restoredRepoId === null || s.restoredRepoId === managedRestoredRepoId) {
            managedRestoredRepoId = nextRestoredRepoId
          }
          return nextRestoredRepoId === s.restoredRepoId ? s : { restoredRepoId: nextRestoredRepoId }
        })
      }
      const restoreError =
        failedOpenEntryIds.size > 0
          ? new Error('session repo restore failed')
          : workspacePaneRestoreFailed ||
              unresolvedPreferredRestoreRepoIds(get().repos, workspacePaneRestoreState).length > 0
            ? new Error('workspace pane preferred tab restore failed')
            : null
      if (restoreError) throw restoreError
    },
  }
}

export function createRepoSessionActions(set: ReposSet, get: ReposGet) {
  return {
    ...createRuntimeRepoSessionActions(set, get),
    ...createRestorableWorkspaceLifecycleActions(set, get),
  }
}

function unresolvedPreferredRestoreRepoIds(
  repos: ReposStore['repos'],
  restoreState: RepoSessionHydrationOptions['workspacePaneRestoreState'],
): string[] {
  if (!restoreState) return []
  return Object.keys(restoreState.preferredWorkspacePaneTabByTargetByRepo).filter((id) => !repos[id])
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError'
}
