import { lastPathSegment } from '#/web/lib/paths.ts'
import { emptyRepo } from '#/web/stores/repos/helpers.ts'
import { restoreRepoProjectionFromSnapshot } from '#/web/stores/repos/persistence.ts'
import { disposeRepoRuntime } from '#/web/stores/repos/runtime.ts'
import { runRepoRefreshIntent } from '#/web/stores/repos/refresh-coordinator.ts'
import { abortRepositoryOperation, probeRepository } from '#/web/repo-client.ts'
import { resolveRemoteRepositoryTarget } from '#/web/remote-client.ts'
import { recordRecentRepo } from '#/web/settings-write-paths.ts'
import type { OpenRepoResult, ReposGet, ReposSet, RepoState, ReposStore } from '#/web/stores/repos/types.ts'
import { nextActiveRepoIdAfterWorkspaceClose } from '#/web/open-workspace-state.ts'
import {
  isRemoteRepoId,
  localRepoSessionEntry,
  normalizeRemoteRepoRef,
  parseRemoteRepoId,
  remoteRepoSessionEntry,
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

function sessionEntryFromInput(input: string | RepoSessionEntry): RepoSessionEntry {
  if (typeof input !== 'string') return input
  if (!isRemoteRepoId(input)) return localRepoSessionEntry(input)
  const parsed = parseRemoteRepoId(input)
  const ref = parsed ? normalizeRemoteRepoRef(parsed) : null
  return ref ? { kind: 'remote', id: ref.id, ref } : localRepoSessionEntry(input)
}

export async function resolveRepoPath(
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

/** Build a fresh repo by layering the restorable cache on top of an
 *  empty shell. `nameHints` is consulted in order; the first non-empty
 *  hint wins, then the cached name, then the last path segment of the
 *  id. The caller mutates the result (e.g. sets `remote.target`,
 *  flips availability) before returning it from `upsertRepo.create`. */
function buildNewRepo(
  s: Pick<ReposStore, 'restorableRepoCache'>,
  id: string,
  nameHints: ReadonlyArray<string | undefined | null>,
): RepoState {
  const cached = s.restorableRepoCache[id]
  const hint = nameHints.find((value): value is string => !!value)
  const name = hint ?? cached?.name ?? lastPathSegment(id)
  return restoreRepoProjectionFromSnapshot(emptyRepo(id, name), cached)
}

function remoteTargetsEqual(a: RemoteRepoTarget | undefined, b: RemoteRepoTarget | undefined): boolean {
  if (!a || !b) return false
  return (
    a.alias === b.alias &&
    a.host === b.host &&
    a.user === b.user &&
    a.port === b.port &&
    a.remotePath === b.remotePath
  )
}

/** Upsert a repo by id, centralising the "if it exists, mutate; if
 *  not, create + insert" pattern shared by addResolvedRepo,
 *  addUnavailableRepo, and insertPlaceholderRepo.
 *  - `create` runs when the id is new and returns the new repo.
 *  - `update`, when provided, runs against the existing repo and
 *    returns the updated state, or `null` to signal "no change". The
 *    returned `changed` is true exactly when the produced state
 *    differs from the input state — true for new repos, true for
 *    any in-place update that returns a non-null value, false when
 *    the existing repo was preserved (no-op or update returned null). */
function upsertRepo(
  s: Pick<ReposStore, 'repos' | 'restorableRepoCache' | 'order'>,
  id: string,
  options: {
    rankById?: ReadonlyMap<string, number>
    create: () => RepoState
    update?: (existing: RepoState) => RepoState | null
  },
): Pick<ReposStore, 'repos' | 'order'> & { changed: boolean; id: string } {
  const existing = s.repos[id]
  if (existing) {
    if (!options.update) return { repos: s.repos, order: s.order, changed: false, id }
    const updated = options.update(existing)
    if (!updated) return { repos: s.repos, order: s.order, changed: false, id }
    return {
      repos: { ...s.repos, [id]: updated },
      order: s.order,
      changed: true,
      id,
    }
  }
  return {
    repos: { ...s.repos, [id]: options.create() },
    order: orderedInsert(s.order, id, options.rankById),
    changed: true,
    id,
  }
}

export function addResolvedRepo(
  s: Pick<ReposStore, 'repos' | 'restorableRepoCache' | 'order'>,
  resolvedRepo: ResolvedRepo,
  rankById?: ReadonlyMap<string, number>,
): Pick<ReposStore, 'repos' | 'order'> & { changed: boolean; id: string } {
  return upsertRepo(s, resolvedRepo.id, {
    rankById,
    create: () => {
      const repo = buildNewRepo(s, resolvedRepo.id, [resolvedRepo.name])
      if (resolvedRepo.target) repo.remote.target = resolvedRepo.target
      return repo
    },
    update: (existing) => {
      // No target means the probe couldn't pin down a concrete host;
      // the existing target (placeholder or stale) stays as-is, but
      // the placeholder → resolved transition is still represented
      // by the absence of a change. A matching target is also a no-op
      // — the resolved probe reaffirmed what we already had.
      if (!resolvedRepo.target) return null
      if (remoteTargetsEqual(existing.remote.target, resolvedRepo.target)) return null
      return {
        ...existing,
        remote: { ...existing.remote, target: resolvedRepo.target },
      }
    },
  })
}

/**
 * Mark a repo as unavailable. Two paths:
 *   - If the repo isn't in the store yet, insert it (e.g. ensureWorkspaceOpen
 *     got a probe failure back). Uses the restorable cache for any cached
 *     name/branches, then flips availability.
 *   - If a placeholder (from insertPlaceholderRepo) is already there, promote
 *     it in place — preserves the cached projection, updates target if
 *     the probe produced one, and flips availability to 'unavailable'.
 *     (The derived connectivity naturally reads as 'unreachable' once
 *     availability is unavailable.)
 */
export function addUnavailableRepo(
  s: Pick<ReposStore, 'repos' | 'restorableRepoCache' | 'order'>,
  id: string,
  reason: string,
  target?: RemoteRepoTarget,
  rankById?: ReadonlyMap<string, number>,
): Pick<ReposStore, 'repos' | 'order'> & { changed: boolean; id: string } {
  return upsertRepo(s, id, {
    rankById,
    create: () => {
      const repo = buildNewRepo(s, id, [target?.displayName])
      if (target) repo.remote.target = target
      repo.availability = { phase: 'unavailable', reason, checkedAt: Date.now() }
      return repo
    },
    update: (existing) => ({
      ...existing,
      availability: { phase: 'unavailable', reason, checkedAt: Date.now() },
      remote: target ? { ...existing.remote, target } : existing.remote,
    }),
  })
}

/**
 * Insert a placeholder tab for a session entry whose probe is still in
 * flight. The placeholder paints the cached branch projection (if any)
 * immediately; the derived connectivity naturally reads as 'connecting'
 * because no remote target has been resolved yet. The probe resolution
 * then promotes it to 'connected' or 'unreachable' via addResolvedRepo /
 * addUnavailableRepo. No-op if the repo is already in the store (so
 * calling this twice for the same entry is safe).
 *
 * Note: we intentionally do NOT set `remote.target` here. The ref only
 * carries alias/remotePath; host/user/port require `resolveRemoteRepositoryTarget`,
 * which hasn't run yet. Until the probe succeeds and addResolvedRepo
 * fills in the target, the placeholder lives in a "known alias,
 * unknown concrete host" state — `deriveConnectivity(repo) === 'connecting'`
 * is the signal callers should branch on rather than reading target fields.
 */
export function insertPlaceholderRepo(
  s: Pick<ReposStore, 'repos' | 'restorableRepoCache' | 'order'>,
  entry: RepoSessionEntry,
  rankById?: ReadonlyMap<string, number>,
): Pick<ReposStore, 'repos' | 'order'> & { changed: boolean; id: string } {
  return upsertRepo(s, entry.id, {
    rankById,
    create: () => {
      const fallbackName = entry.kind === 'remote' ? entry.ref.displayName : null
      const repo = buildNewRepo(s, entry.id, [fallbackName])
      // 'refreshing' so the cached branches render with a stale indicator
      // (resourceInitialLoading would hide them).
      const cached = s.restorableRepoCache[entry.id]
      if (cached && cached.data.branches.length > 0) {
        repo.resources.snapshot = { ...repo.resources.snapshot, phase: 'refreshing', error: null, stale: true }
      }
      return repo
    },
  })
}

export function refreshInitialRepoState(get: ReposGet, refresh: InitialRepoRefresh) {
  const repo = get().repos[refresh.id]
  if (!repo || repo.instanceToken !== refresh.token) return
  void runRepoRefreshIntent(get, {
    kind: 'core-data-changed',
    reason: 'initial-load',
    id: refresh.id,
    token: refresh.token,
  })
}

function applyWorkspaceOpen(
  s: Pick<ReposStore, 'repos' | 'order' | 'restorableRepoCache'>,
  repo: ResolvedRepo,
): Pick<ReposStore, 'repos' | 'order'> & { changed: boolean; id: string } {
  return addResolvedRepo(s, repo)
}

export function createRuntimeRepoLifecycleActions(
  set: ReposSet,
  get: ReposGet,
): Pick<ReposStore, 'ensureWorkspaceOpen' | 'closeRepo'> {
  return {
    async ensureWorkspaceOpen(pathOrEntry: string | RepoSessionEntry): Promise<OpenRepoResult> {
      const entry = sessionEntryFromInput(pathOrEntry)
      const resolved = await resolveRepoPath(entry, undefined, 'error.not-git-repo')
      if (!resolved.repo) return { ok: false, message: resolved.reason ?? 'error.not-git-repo' }
      const repo = resolved.repo
      const { id } = repo
      let initialRefresh: InitialRepoRefresh | null = null
      const recentEntry = repo.target ? remoteRepoSessionEntry(repo.target) : { kind: 'local' as const, id }
      void recordRecentRepo(recentEntry).catch(() => {
        /* recent menu is best-effort */
      })

      set((s) => {
        const { repos, order, changed } = applyWorkspaceOpen(s, repo)
        // Only kick off an initial refresh when the resolved probe
        // actually changed the store (new repo, or existing placeholder
        // got a new target). A matching target is a no-op set and the
        // cached data is already coherent — re-running the snapshot/
        // status pipeline would just duplicate the in-flight work.
        if (changed) initialRefresh = { id, token: repos[id]!.instanceToken }
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
  }
}
