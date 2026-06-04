import pLimit from 'p-limit'
import { lastPathSegment } from '#/web/lib/paths.ts'
import { emptyRepo } from '#/web/stores/repos/helpers.ts'
import { hydrateCachedRepo } from '#/web/stores/repos/persistence.ts'
import { disposeRepoRuntime } from '#/web/stores/repos/runtime.ts'
import { runRepoRefreshIntent } from '#/web/stores/repos/refresh-coordinator.ts'
import {
  abortRepositoryOperation,
  addRecentRepo,
  probeRepository,
  resolveRemoteRepositoryTarget,
} from '#/web/app-data-client.ts'
import type { OpenRepoResult, ReposGet, ReposSet, ReposStore } from '#/web/stores/repos/types.ts'
import {
  activeRepoIdAfterWorkspaceHydration,
  nextActiveRepoIdAfterWorkspaceClose,
} from '#/web/open-workspace-state.ts'
import {
  isRemoteRepoId,
  localRepoSessionEntry,
  normalizeRemoteRepoRef,
  parseRemoteRepoId,
  remoteRepoSessionEntry,
  repoSessionEntryId,
  type RemoteRepoTarget,
  type RepoSessionEntry,
} from '#/shared/remote-repo.ts'
interface ResolvedRepo {
  id: string
  name: string
  target?: RemoteRepoTarget
}

interface ProbeResult {
  input: string
  reason: string | null
  repo: ResolvedRepo | null
  target?: RemoteRepoTarget
}

interface InitialRepoRefresh {
  id: string
  token: number
}

const SESSION_PROBE_CONCURRENCY = 4

function sessionEntryFromInput(input: string | RepoSessionEntry): RepoSessionEntry {
  if (typeof input !== 'string') return input
  if (!isRemoteRepoId(input)) return localRepoSessionEntry(input)
  const parsed = parseRemoteRepoId(input)
  const ref = parsed ? normalizeRemoteRepoRef(parsed) : null
  return ref ? { kind: 'remote', id: ref.id, ref } : localRepoSessionEntry(input)
}

async function resolveRepoPath(
  input: string | RepoSessionEntry,
  onError?: (err: unknown) => void,
  fallbackError = 'error.failed-read-repo',
): Promise<ProbeResult> {
  const entry = sessionEntryFromInput(input)
  try {
    let target: RemoteRepoTarget | undefined
    if (entry.kind === 'remote') target = await resolveRemoteRepositoryTarget(entry.ref)
    const probe = await probeRepository(entry.id)
    if (!probe?.ok || !probe.root) {
      return {
        input: entry.id,
        reason: probe?.message ?? 'error.not-git-repo',
        repo: null,
        target,
      }
    }
    return {
      input: entry.id,
      reason: null,
      repo: {
        id: probe.root,
        name: probe.name ?? (entry.kind === 'remote' ? entry.ref.displayName : lastPathSegment(probe.root)),
        ...(target ? { target } : {}),
      },
      target,
    }
  } catch (err) {
    onError?.(err)
    return {
      input: entry.id,
      reason: err instanceof Error ? err.message : fallbackError,
      repo: null,
    }
  }
}

function orderedInsert(order: string[], id: string, rankById?: ReadonlyMap<string, number>): string[] {
  if (!rankById) return [...order, id]
  const rank = rankById.get(id)
  if (rank === undefined) return [...order, id]
  const next = [...order]
  const index = next.findIndex((existing) => {
    const existingRank = rankById.get(existing)
    return existingRank !== undefined && existingRank > rank
  })
  next.splice(index === -1 ? next.length : index, 0, id)
  return next
}

function addResolvedRepo(
  s: Pick<ReposStore, 'repos' | 'repoCache' | 'order'>,
  resolvedRepo: ResolvedRepo,
  rankById?: ReadonlyMap<string, number>,
): Pick<ReposStore, 'repos' | 'order'> & { changed: boolean } {
  const { id, name } = resolvedRepo
  const existing = s.repos[id]
  if (existing) {
    if (
      !resolvedRepo.target ||
      (existing.remote.target &&
        existing.remote.target.alias === resolvedRepo.target.alias &&
        existing.remote.target.host === resolvedRepo.target.host &&
        existing.remote.target.user === resolvedRepo.target.user &&
        existing.remote.target.port === resolvedRepo.target.port &&
        existing.remote.target.remotePath === resolvedRepo.target.remotePath)
    ) {
      return { repos: s.repos, order: s.order, changed: false }
    }
    return {
      repos: {
        ...s.repos,
        [id]: {
          ...existing,
          remote: {
            ...existing.remote,
            target: resolvedRepo.target,
          },
        },
      },
      order: s.order,
      changed: false,
    }
  }
  const repo = hydrateCachedRepo(emptyRepo(id, name), s.repoCache[id])
  if (resolvedRepo.target) repo.remote.target = resolvedRepo.target
  return {
    repos: { ...s.repos, [id]: repo },
    order: orderedInsert(s.order, id, rankById),
    changed: true,
  }
}

function addUnavailableRepo(
  s: Pick<ReposStore, 'repos' | 'repoCache' | 'order'>,
  id: string,
  reason: string,
  target?: RemoteRepoTarget,
  rankById?: ReadonlyMap<string, number>,
): Pick<ReposStore, 'repos' | 'order'> & { changed: boolean } {
  if (s.repos[id]) return { repos: s.repos, order: s.order, changed: false }
  const cached = s.repoCache[id]
  const repo = hydrateCachedRepo(emptyRepo(id, cached?.name || target?.displayName || lastPathSegment(id)), cached)
  if (target) repo.remote.target = target
  repo.availability = { phase: 'unavailable', reason, checkedAt: Date.now() }
  return {
    repos: { ...s.repos, [id]: repo },
    order: s.order.includes(id) ? s.order : orderedInsert(s.order, id, rankById),
    changed: true,
  }
}

function refreshInitialRepoState(get: ReposGet, refresh: InitialRepoRefresh) {
  const repo = get().repos[refresh.id]
  if (!repo || repo.instanceToken !== refresh.token) return
  void runRepoRefreshIntent(get, { kind: 'initial-load', id: refresh.id, token: refresh.token })
}

function ensureWorkspaceOpen(
  s: Pick<ReposStore, 'repos' | 'order' | 'repoCache'>,
  repo: ResolvedRepo,
): {
  repos: ReposStore['repos']
  order: string[]
  changed: boolean
  id: string
} {
  const { repos, order, changed } = addResolvedRepo(s, repo)
  return { repos, order, changed, id: repo.id }
}

export function createLifecycleActions(set: ReposSet, get: ReposGet) {
  return {
    async ensureWorkspaceOpen(pathOrEntry: string | RepoSessionEntry): Promise<OpenRepoResult> {
      const entry = sessionEntryFromInput(pathOrEntry)
      const resolved = await resolveRepoPath(entry, undefined, 'error.not-git-repo')
      if (!resolved.repo) return { ok: false, message: resolved.reason ?? 'error.not-git-repo' }
      const repo = resolved.repo
      const { id } = repo
      let initialRefresh: InitialRepoRefresh | null = null
      const recentEntry = repo.target ? remoteRepoSessionEntry(repo.target) : { kind: 'local' as const, id }
      void addRecentRepo(recentEntry).catch(() => {
        /* recent menu is best-effort */
      })

      set((s) => {
        const existingRepo = s.repos[id]
        const { repos, order, changed } = ensureWorkspaceOpen(s, repo)
        const repoToRefresh = changed ? repos[id] : existingRepo
        if (repoToRefresh) initialRefresh = { id, token: repoToRefresh.instanceToken }
        return changed ? { repos, order } : s
      })

      if (initialRefresh) refreshInitialRepoState(get, initialRefresh)
      return { ok: true, id }
    },

    closeRepo(id: string) {
      disposeRepoRuntime(id)
      // Tell main to abort any cancellable network op for this repo —
      // otherwise a `git push` started right before the user closed the
      // tab keeps running for up to the network timeout, charged to a
      // tab that no longer exists. Fire-and-forget; failure is fine.
      void abortRepositoryOperation(id).catch(() => {
        /* main may have nothing to abort — ignore */
      })
      set((s) => {
        if (!s.repos[id]) return s
        const repos = { ...s.repos }
        const branchSearchQueries = { ...s.branchSearchQueries }
        const selectedTerminalByWorktree = { ...s.selectedTerminalByWorktree }
        delete repos[id]
        delete branchSearchQueries[id]
        for (const worktreeKey of Object.keys(selectedTerminalByWorktree)) {
          if (worktreeKey.startsWith(`${id}\0`)) delete selectedTerminalByWorktree[worktreeKey]
        }
        const order = s.order.filter((x) => x !== id)
        const activeId = nextActiveRepoIdAfterWorkspaceClose(s.order, s.activeId, id)
        return { repos, branchSearchQueries, selectedTerminalByWorktree, order, activeId }
      })
    },

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
