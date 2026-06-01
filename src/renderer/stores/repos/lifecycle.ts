import pLimit from 'p-limit'
import { lastPathSegment } from '#/renderer/lib/paths.ts'
import { emptyRepo, inFlightFetchById } from '#/renderer/stores/repos/helpers.ts'
import { hydrateCachedRepo } from '#/renderer/stores/repos/persistence.ts'
import { disposeRepoRuntime } from '#/renderer/stores/repos/runtime.ts'
import { runInitialRepoLoad } from '#/renderer/stores/repos/refresh-workflows.ts'
import type { OpenRepoResult, ReposGet, ReposSet, ReposStore } from '#/renderer/stores/repos/types.ts'
import { rpc } from '#/renderer/rpc.ts'
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
    if (entry.kind === 'remote') target = (await rpc.remote.resolveTarget.query(entry.ref)).target
    const probe = await rpc.repo.probe.query({ cwd: entry.id })
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

function activeAfterHydrateStep(
  s: Pick<ReposStore, 'activeId'>,
  repos: Record<string, unknown>,
  order: string[],
  activeRepo: string | null,
  managedActiveId: string | null,
): string | null {
  if (s.activeId && s.activeId !== managedActiveId && repos[s.activeId]) return s.activeId
  if (activeRepo && repos[activeRepo]) return activeRepo
  return order[0] ?? null
}

function refreshInitialRepoState(get: ReposGet, refresh: InitialRepoRefresh) {
  const repo = get().repos[refresh.id]
  if (!repo || repo.instanceToken !== refresh.token) return
  runInitialRepoLoad(get, refresh)
}

export function createLifecycleActions(set: ReposSet, get: ReposGet) {
  return {
    async openRepo(pathOrEntry: string | RepoSessionEntry, options?: { activate?: boolean }): Promise<OpenRepoResult> {
      const entry = sessionEntryFromInput(pathOrEntry)
      const resolved = await resolveRepoPath(entry, undefined, 'error.not-git-repo')
      if (!resolved.repo) return { ok: false, message: resolved.reason ?? 'error.not-git-repo' }
      const repo = resolved.repo
      const { id } = repo
      const activate = options?.activate !== false
      let initialRefresh: InitialRepoRefresh | null = null
      const recentEntry = repo.target ? remoteRepoSessionEntry(repo.target) : { kind: 'local' as const, id }
      void rpc.settings.addRecentRepo.mutate({ repo: recentEntry }).catch(() => {
        /* recent menu is best-effort */
      })

      // Branch on the two axes (already in store? activating?) so each
      // case writes only what actually changes. zustand v5 short-circuits
      // notification when the setter returns the *same* state reference
      // (`Object.is(next, prev)`), so returning `s` when there's nothing
      // to do skips both the merge and the listener fan-out.
      set((s) => {
        const existingRepo = s.repos[id]
        const { repos, order, changed } = addResolvedRepo(s, repo)
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
      disposeRepoRuntime(id)
      // Tell main to abort any cancellable network op for this repo —
      // otherwise a `git push` started right before the user closed the
      // tab keeps running for up to the network timeout, charged to a
      // tab that no longer exists. Fire-and-forget; failure is fine.
      void rpc.repo.abort.mutate({ cwd: id }).catch(() => {
        /* main may have nothing to abort — ignore */
      })
      set((s) => {
        if (!s.repos[id]) return s
        const repos = { ...s.repos }
        const branchSearchQueries = { ...s.branchSearchQueries }
        delete repos[id]
        delete branchSearchQueries[id]
        const order = s.order.filter((x) => x !== id)
        let activeId = s.activeId
        // Slide focus to the right neighbour; fall back to the left if
        // we just removed the rightmost tab.
        if (activeId === id) {
          const idx = s.order.indexOf(id)
          activeId = order[idx] ?? order[idx - 1] ?? null
        }
        return { repos, branchSearchQueries, order, activeId }
      })
    },

    async hydrateSession(openRepos: RepoSessionEntry[], activeRepo: string | null) {
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
                const activeId = activeAfterHydrateStep(s, repos, order, activeRepo, managedActiveId)
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
              const activeId = activeAfterHydrateStep(s, repos, order, activeRepo, managedActiveId)
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
        const activeId = activeAfterHydrateStep(s, s.repos, s.order, activeRepo, managedActiveId)
        if (s.activeId === null || s.activeId === managedActiveId) managedActiveId = activeId
        return {
          activeId,
          sessionReady: true,
        }
      })
    },
  }
}
